import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import Anthropic from '@anthropic-ai/sdk';
import { noul, TypeSafeClient, type EntryType } from '@typesafe-ai/sdk';
import { and, asc, desc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm';
import { aggregate1hTo4h, donchianBounds, TIMEFRAME_MS } from '@microtrading/core';
import { DbService } from '../db/db.service.js';
import { journal, paperAccount } from '../db/schema.js';
import { CandleRepository } from '../market-data/candle-repository.js';

/**
 * Phase 4 LLM analyst — OBSERVABILITY ONLY (docs/PHASE4-PREREG.md; read it).
 *
 * Writes `kind='analyst'` rows. Nothing reads them: no strategy consumes a
 * feature in V1, so this adds zero trials (N stays 34).
 *
 * Isolation is structural, not a prompt instruction (§7, §8):
 * - It never touches the loop. It POLLS the journal on its own cron for the
 *   trigger rows the loop already writes (fill, risk, kill-switch,
 *   stale-data-halt) — the loop has no reference to this service at all.
 * - It has no write path to the broker or kill switch: it only SELECTs
 *   paper_account and only INSERTs journal rows.
 * - Every failure is caught and journaled as ops/analyst-error.
 *
 * Forward clock (SPEC §2.5 hard rule 2): on first start the cursor is set to
 * the journal's current end, so nothing is ever generated for a past event.
 * ponytail: events that land while the process is down are picked up on
 * restart (the cursor is derived from the journal), but `daily` is not
 * back-filled — a missed day stays missed.
 */

/** Pinned by PHASE4-PREREG §5 + Amendment 1. A change here is a new featureVersion. */
const MODEL = 'claude-opus-5-5';
const FEATURE_VERSION = '1';
const MAX_CALLS_PER_UTC_DAY = 50;
const MAX_INPUT_TOKENS = 8000;
const MAX_TOKENS = 4000; // Amendment 1: thinking tokens count toward this
const TIMEOUT_MS = 60_000; // Amendment 1
const USD_PER_MTOK = { input: 4, output: 20 }; // claude-opus-5-5 list price
const LOOKBACK_DAYS = 30;

/**
 * Guardrail (PHASE4-PREREG Amendment 2): TypeSafe Jev yes/no checks on every
 * analyst row, journaled as `analyst-check`. Observational — it never blocks,
 * edits or re-asks the analyst (re-asking until a check passes would be the
 * prompt-hunting §4 forbids). Pinned version: the `jev-latest` alias moves.
 */
export const JEV_MODEL = 'jev-1.13.0';
const JEV_USD_PER_MTOK = 0.042; // input only; output tokens are free
export const CHECKS = {
  predictsPrice: noul(
    'Does `analysis.commentary` or `analysis.review.note` predict a future BTC price, price level, or price direction?',
  ),
  recommendsTrade: noul(
    'Does `analysis.commentary` or `analysis.review.note` recommend buying, selling, holding, or changing a position or a stop?',
  ),
  contradictsInputs: noul('Does `analysis` state any number or fact that contradicts `inputs`?'),
};

type Trigger = 'daily' | 'fill' | 'stop-hit' | 'risk-block' | 'stale-data-halt';

const SYSTEM = `You are the observability analyst for a paper-trading system. A deterministic \
rule (a Donchian channel breakout on closed 4h BTC/USDC candles, long-only, with an ATR stop) \
makes every trading decision; you make none and nothing you write is read by any strategy. \
You are given only closed candles and journal rows that already existed when you were called.

Write for a human reviewing the system later. Be concrete and cite the numbers you were given. \
Do not predict prices or recommend trades. Say plainly when the inputs do not support a conclusion.

regime.label: bull (sustained higher highs/lows), bear (sustained lower), range (no sustained \
direction), rebound (a sharp recovery after a decline). regime.confidence is your probability \
that the label is right, 0 to 1.
commentary: at most 600 characters, plain text.
review (only when asked): judge the rule's execution of THIS trade against what the candles show — \
ok (behaved as designed), early / late (the trigger fired at an unrepresentative candle), \
avoidable (a documented risk rule should have blocked it). note: at most 400 characters.`;

const REGIME = {
  type: 'object',
  properties: {
    label: { type: 'string', enum: ['bull', 'bear', 'range', 'rebound'] },
    confidence: { type: 'number' },
  },
  required: ['label', 'confidence'],
  additionalProperties: false,
};
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ok', 'early', 'late', 'avoidable'] },
    note: { type: 'string' },
  },
  required: ['verdict', 'note'],
  additionalProperties: false,
};
const schemaFor = (withReview: boolean) => ({
  type: 'object',
  properties: { regime: REGIME, commentary: { type: 'string' }, ...(withReview ? { review: REVIEW } : {}) },
  required: ['regime', 'commentary', ...(withReview ? ['review'] : [])],
  additionalProperties: false,
});

const TASK: Record<Trigger, string> = {
  daily: 'Daily regime commentary on the closed 4h candles and the last 30 days of journal activity.',
  fill: 'Post-trade review of the fill in `event`: what the rule saw, what the market did, what the fill model charged.',
  'stop-hit': 'Post-trade review of the STOP fill in `event`: what the rule saw, what the market did, what the fill model charged.',
  'risk-block': 'Explain the risk block in `event` against the candles.',
  'stale-data-halt': 'The loop halted on stale data (`event`). One note on what the last candles showed; nothing more is known.',
};

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Which trigger a journal row is, or null. Pure — the whole routing table (§1). */
export function triggerFor(kind: string, payload: Record<string, unknown>): Trigger | 'pause' | 'resume' | null {
  if (kind === 'fill') {
    if (payload['reason'] === 'kill-switch flatten') return null; // the kill-switch row covers it
    return payload['reason'] === 'stop' ? 'stop-hit' : 'fill';
  }
  if (kind === 'risk') return 'risk-block';
  if (kind === 'ops' && payload['event'] === 'kill-switch') return payload['on'] === true ? 'pause' : 'resume';
  if (kind === 'ops' && payload['event'] === 'stale-data-halt') return 'stale-data-halt';
  return null;
}

@Injectable()
export class AnalystService {
  private readonly log = new Logger(AnalystService.name);
  private client: Anthropic | null = null;
  private jev: TypeSafeClient | null = null;
  private cursor: number | null = null;
  private busy = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dbs: DbService,
    private readonly repo: CandleRepository,
  ) {}

  private get enabled(): boolean {
    return this.config.get('ENABLE_LLM_ANALYST') === 'true' && Boolean(this.config.get('ANTHROPIC_API_KEY'));
  }

  private get symbol(): string {
    return this.config.get<string>('SYMBOL', 'BTC/USDC');
  }

  private async journalRow(kind: string, payload: object): Promise<number | null> {
    try {
      const [row] = await this.dbs.db.insert(journal).values({ kind, payload }).returning({ id: journal.id });
      return row?.id ?? null;
    } catch (err) {
      this.log.warn(`analyst journal insert failed: ${String(err)}`);
      return null;
    }
  }

  /** Amendment 2 guardrail. Never throws; skipped when TYPESAFE_API_KEY is unset. */
  async guardrail(analystJournalId: number | null, analysis: object, inputs: object): Promise<void> {
    const apiKey = this.config.get<string>('TYPESAFE_API_KEY');
    if (!apiKey) return;
    try {
      const jev = (this.jev ??= new TypeSafeClient({ apiKey, defaultModel: JEV_MODEL, timeout: 30_000 }));
      const r = await jev.systemOne({ model: JEV_MODEL, state: JSON.parse(JSON.stringify({ analysis, inputs })) as EntryType, questions: CHECKS });
      await this.journalRow('analyst-check', {
        analystJournalId,
        model: r.model,
        questionsHash: sha256(JSON.stringify(CHECKS)),
        predictsPrice: r.answers.predictsPrice.noul,
        recommendsTrade: r.answers.recommendsTrade.noul,
        contradictsInputs: r.answers.contradictsInputs.noul,
        usage: { inputTokens: r.usage.input_tokens, costUsd: (r.usage.input_tokens * JEV_USD_PER_MTOK) / 1e6 },
      });
    } catch (err) {
      await this.journalRow('ops', {
        event: 'analyst-check-error',
        analystJournalId,
        message: (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300),
      });
    }
  }

  @Cron('*/5 * * * *')
  async poll(): Promise<void> {
    if (!this.enabled || this.busy) return;
    this.busy = true;
    try {
      await this.drainEvents();
    } catch (err) {
      await this.journalRow('ops', { event: 'analyst-error', trigger: 'poll', message: String(err).slice(0, 300) });
    } finally {
      this.busy = false;
    }
  }

  /** 06:10 UTC, after the 06:00 daily summary (§1). */
  @Cron('10 6 * * *')
  async daily(): Promise<void> {
    if (!this.enabled) return;
    try {
      const today = new Date(new Date().toISOString().slice(0, 10));
      const done = await this.dbs.db
        .select({ id: journal.id })
        .from(journal)
        .where(and(eq(journal.kind, 'analyst'), gte(journal.at, today), sql`${journal.payload}->>'trigger' = 'daily'`))
        .limit(1);
      if (done.length === 0) await this.analyse('daily', null);
    } catch (err) {
      await this.journalRow('ops', { event: 'analyst-error', trigger: 'daily', message: String(err).slice(0, 300) });
    }
  }

  private async initCursor(): Promise<number> {
    // Resume after the last source row this service answered; first start = journal end (no backfill).
    const [handled] = await this.dbs.db
      .select({ v: sql<number | null>`max((${journal.payload}->>'sourceJournalId')::int)` })
      .from(journal)
      .where(sql`${journal.kind} = 'analyst' or (${journal.kind} = 'ops' and ${journal.payload}->>'event' like 'analyst-%')`);
    if (handled?.v != null) return Number(handled.v);
    const [end] = await this.dbs.db.select({ v: sql<number>`coalesce(max(${journal.id}), 0)` }).from(journal);
    const fromId = Number(end?.v ?? 0);
    await this.journalRow('ops', { event: 'analyst-started', sourceJournalId: fromId, model: MODEL, featureVersion: FEATURE_VERSION });
    return fromId;
  }

  private async drainEvents(): Promise<void> {
    this.cursor ??= await this.initCursor();
    const rows = await this.dbs.db
      .select()
      .from(journal)
      .where(and(gt(journal.id, this.cursor), inArray(journal.kind, ['fill', 'risk', 'ops'])))
      .orderBy(asc(journal.id))
      .limit(500);
    for (const r of rows) {
      this.cursor = r.id;
      const t = triggerFor(r.kind, r.payload as Record<string, unknown>);
      if (t === null) continue;
      if (t === 'pause' || t === 'resume') {
        // §8: the analyst is a spend and a halted account has nothing to review — marker rows, no call.
        await this.journalRow('ops', { event: t === 'pause' ? 'analyst-paused' : 'analyst-resumed', sourceJournalId: r.id });
        continue;
      }
      if (t === 'stale-data-halt' && (await this.haltAlreadyNoted(r.id))) continue; // one note per halt
      await this.analyse(t, r);
    }
  }

  /** True if the previous tick outcome before this row was already a stale-data halt. */
  private async haltAlreadyNoted(id: number): Promise<boolean> {
    const [prev] = await this.dbs.db
      .select({ kind: journal.kind })
      .from(journal)
      .where(and(lt(journal.id, id), sql`(${journal.kind} = 'decision' or ${journal.payload}->>'event' = 'stale-data-halt')`))
      .orderBy(desc(journal.id))
      .limit(1);
    return prev?.kind === 'ops';
  }

  private async analyse(trigger: Trigger, source: { id: number; at: Date; kind: string; payload: unknown } | null): Promise<void> {
    const sourceJournalId = source?.id ?? null;
    const fail = (message: string) =>
      this.journalRow('ops', { event: 'analyst-error', trigger, sourceJournalId, message: message.slice(0, 300) });
    try {
      const [acct] = await this.dbs.db.select().from(paperAccount).where(eq(paperAccount.symbol, this.symbol));
      if (acct?.killSwitch === 'on') return; // §8: paused; the analyst-paused row already records it

      const dayStart = new Date(new Date().toISOString().slice(0, 10));
      const [calls] = await this.dbs.db
        .select({ n: sql<number>`count(*)` })
        .from(journal)
        .where(
          and(
            gte(journal.at, dayStart),
            sql`(${journal.kind} = 'analyst' or ${journal.payload}->>'event' = 'analyst-error')`,
          ),
        );
      if (Number(calls?.n ?? 0) >= MAX_CALLS_PER_UTC_DAY) {
        await this.journalRow('ops', { event: 'analyst-capped', trigger, sourceJournalId, cap: 'calls-per-day' });
        return;
      }

      const inputs = await this.inputs(trigger, source, acct);
      const withReview = trigger === 'fill' || trigger === 'stop-hit';
      const schema = schemaFor(withReview);
      const user = `${TASK[trigger]}\n\nINPUTS (JSON):\n${JSON.stringify(inputs)}`;
      const client = (this.client ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 }));

      const counted = await client.messages.countTokens({ model: MODEL, system: SYSTEM, messages: [{ role: 'user', content: user }] });
      if (counted.input_tokens > MAX_INPUT_TOKENS) {
        await this.journalRow('ops', { event: 'analyst-capped', trigger, sourceJournalId, cap: 'input-tokens', inputTokens: counted.input_tokens });
        return;
      }

      const started = Date.now();
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      });
      const latencyMs = Date.now() - started;
      const usage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        costUsd: (res.usage.input_tokens * USD_PER_MTOK.input + res.usage.output_tokens * USD_PER_MTOK.output) / 1e6,
      };
      const text = res.content.find((b) => b.type === 'text');
      if (res.stop_reason !== 'end_turn' || !text || text.type !== 'text') {
        await fail(`stop_reason ${res.stop_reason}${res.stop_details ? ` (${res.stop_details.category})` : ''}; usage ${JSON.stringify(usage)}`);
        return;
      }
      const out = JSON.parse(text.text) as {
        regime: { label: string; confidence: number };
        commentary: string;
        review?: { verdict: string; note: string };
      };

      const analysis = {
        commentary: out.commentary.slice(0, 600),
        ...(out.review ? { review: { fillId: sourceJournalId, verdict: out.review.verdict, note: out.review.note.slice(0, 400) } } : {}),
      };
      const analystId = await this.journalRow('analyst', {
        featureVersion: FEATURE_VERSION,
        trigger,
        asOf: inputs.asOf,
        sourceJournalId,
        inputsHash: sha256(user),
        model: res.model,
        promptHash: sha256(SYSTEM + JSON.stringify(TASK) + JSON.stringify(schemaFor(true))),
        regime: out.regime,
        ...analysis,
        usage,
        latencyMs,
      });
      await this.guardrail(analystId, { regime: out.regime, ...analysis }, inputs);
      this.log.log(`analyst ${trigger}: ${out.regime.label} (${usage.costUsd.toFixed(4)} USD, ${latencyMs} ms)`);
    } catch (err) {
      await fail(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    }
  }

  /** Only closed candles and rows that already exist (§1, §2). */
  private async inputs(
    trigger: Trigger,
    source: { id: number; at: Date; kind: string; payload: unknown } | null,
    acct: typeof paperAccount.$inferSelect | undefined,
  ) {
    const now = Date.now();
    const closed1h = (await this.repo.fetchSince(this.symbol, '1h', now - (LOOKBACK_DAYS + 8) * 86_400_000)).filter(
      (c) => c.timestamp + TIMEFRAME_MS['1h'] <= now,
    );
    const all4h = aggregate1hTo4h(closed1h).filter((c) => c.timestamp + TIMEFRAME_MS['4h'] <= now);
    const params = JSON.parse(this.config.get<string>('STRATEGY_PARAMS', '{"entryLookback":40,"exitLookback":10}')) as Record<string, number>;
    const bounds = donchianBounds(all4h, params['entryLookback'] ?? 40, params['exitLookback'] ?? 10);
    const recent4h = all4h.filter((c) => c.timestamp >= now - LOOKBACK_DAYS * 86_400_000);
    const activity = await this.dbs.db
      .select({ id: journal.id, at: journal.at, kind: journal.kind, payload: journal.payload })
      .from(journal)
      .where(and(inArray(journal.kind, ['fill', 'risk']), gte(journal.at, new Date(now - LOOKBACK_DAYS * 86_400_000))))
      .orderBy(asc(journal.id));
    const last = recent4h[recent4h.length - 1];
    return {
      asOf: last ? last.timestamp + TIMEFRAME_MS['4h'] : now,
      symbol: this.symbol,
      strategy: { family: this.config.get<string>('STRATEGY_FAMILY', 'donchian-breakout'), params },
      channel: bounds ? { upper: bounds.upper, lower: bounds.lower } : null,
      account: acct
        ? { cash: acct.cash, positionQty: acct.positionQty, avgEntryPrice: acct.avgEntryPrice, stopPrice: acct.stopPrice }
        : null,
      event: source ? { journalId: source.id, at: source.at.toISOString(), kind: source.kind, payload: source.payload } : null,
      journal30d: activity.map((r) => ({ id: r.id, at: r.at.toISOString(), kind: r.kind, payload: r.payload })),
      // [openTimeISO, open, high, low, close] — closed 4h candles, oldest first
      candles4h: recent4h.map((c) => [new Date(c.timestamp).toISOString().slice(0, 13), c.open, c.high, c.low, c.close]),
      trigger,
    };
  }
}
