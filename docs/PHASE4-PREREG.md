# Phase 4 — LLM analyst: pre-registration

**Written 2026-08-25, before any LLM call has been made in this project.**
Immutable in the same sense as `experiments/*.json`: changes are appended as
dated amendments, never edited in place. This document closes the eight holes
in SPEC §2.5 that `docs/STRESS-TEST-2026-08-25.md` §F listed. Where a choice
was open, the choice and its reason are stated; the human delegated these
decisions on 2026-08-25.

## 0. What Phase 4 is, and is not

- **Starts:** after the soak ends (2026-09-06 00:02Z, SPEC §7.5 C6) and REPORT
  §10 is written. Not before — the soak is meant to be boring.
- **Scope: observability only.** The analyst writes to the journal. **No
  strategy reads a feature in V1.** This makes Phase 4 add **zero trials** —
  nothing is selected on — so N stays at 34 and no published number is
  re-deflated.
- **What it can deliver:** a working, look-ahead-safe, journaled integration;
  the forward clock started (SPEC §2.5 hard rule 2 — features exist only from
  the moment they were generated live; the clock cannot be backfilled).
- **What it cannot deliver, stated now so the writeup does not overclaim:** a
  verdict on whether AI adds value. Turnover is 10–25 round trips/yr on one
  pair; three months yields ~3–6 trades against §7.4's 100-trade floor. The
  ablation comparison (§6) would be two samples of a handful each. Phase 4 in
  V1 answers "can this be built honestly", not "does it help".

## 1. Triggers *(closes "event-triggered", undefined in §2.5)*

| Trigger | When | Purpose |
|---|---|---|
| `daily` | 06:10 UTC, after the daily P&L push | regime commentary on the last closed 4h candles + the last 30 days |
| `fill` | on any paper fill (entry or exit) | post-trade review: what the rule saw, what the market did, what the fill model charged |
| `stop-hit` | on a stop fill | same, flagged |
| `risk-block` | daily-cutoff or vol-circuit-breaker block journaled | explain the block against the candles |
| `kill-switch` | on → analyst pauses; off → one `resume` note | see §8 |
| `stale-data-halt` | on halt | one note; nothing while halted |

Maximum one call per trigger event; `daily` is the only scheduled one.
Nothing runs on a forming candle, and the analyst is given **only closed
candles** and **only journal rows that already exist** — the same discipline
as the strategy.

## 2. Inputs *(closes "news/sentiment features", unsourced in §2.5)*

**No external news or sentiment source in V1.** Dropped from scope, recorded in
SPEC Appendix D. Reasons: no licensed source is named anywhere; a 4h
trend-follower with 10–25 trades a year has no consumer for it; and a text
feed is the one input whose look-ahead safety cannot be audited from the
journal alone.

Inputs are exactly: closed 1h/4h candles for BTC/USDC (the traded pair) and
the universe, the journal (decisions, fills, equity, risk, ops), `/api/status`,
and the strategy's own channel bounds. All already exist and are timestamped.

## 3. Output schema *(closes "structured JSON out")*

One journal row per call, `kind = 'analyst'`, payload:

```json
{
  "featureVersion": "1",
  "trigger": "daily | fill | stop-hit | risk-block | kill-switch | stale-data-halt",
  "asOf": 1787641200000,
  "inputsHash": "sha256 of the exact prompt inputs",
  "model": "claude-opus-5",
  "promptHash": "sha256 of the system + user prompt templates",
  "regime": { "label": "bull | bear | range | rebound", "confidence": 0.0 },
  "commentary": "≤ 600 chars, plain text",
  "review": { "fillId": 3393, "verdict": "ok | early | late | avoidable", "note": "≤ 400 chars" },
  "usage": { "inputTokens": 0, "outputTokens": 0, "costUsd": 0.0 },
  "latencyMs": 0
}
```

`review` is present only for `fill` / `stop-hit`. Produced with structured
outputs (`output_config.format`), so a malformed reply is an API error, not a
parsing guess. **A change to any field is `featureVersion` + 1** and is
appended here with a date.

## 4. Provenance on every row *(closes prompt-hunting)*

`model`, `promptHash`, `inputsHash`, `featureVersion` on every row. **A prompt
edit is a new feature version, logged here before it runs.** Iterating prompts
and keeping the one whose commentary "looks best" is multiple testing in a new
costume — SPEC §7.5 C5 caps N across families; this caps the analogue for
prompts: **≤ 3 prompt versions in Phase 4, pre-registered, none selected on
outcome.** Reason: there is no outcome to select on when no strategy consumes
the feature — which is exactly why the cap is cheap now and expensive later.

## 5. Model, cost cap *(closes "~$1–2/mo")*

- Model pinned: **`claude-opus-5`** (Anthropic SDK, TypeScript, `@anthropic-ai/sdk`),
  adaptive thinking, `output_config.effort: "medium"` — the task is
  commentary on ~5k tokens of tabular input, not reasoning under uncertainty.
- Budget at list price ($5 / $25 per MTok): ~40 calls/month × (5k in + 1k out)
  ≈ **$2/month**. Within §2.5's figure.
- **Hard caps, enforced in code, not by hope:** ≤ 50 calls per UTC day, ≤ 8k
  input and ≤ 1.5k output tokens per call, `max_tokens` set accordingly. A cap
  hit journals `ops/analyst-capped` and skips; it never queues.
- Usage and cost recorded on every row (§3), so the month's spend is a SQL
  query, not an invoice surprise.

## 6. Decision rule for LLM-using strategies *(closes the §7.4 gap)*

Not exercised in V1, written now because §2.5 requires an ablation and names
no statistic:

- An LLM-using strategy is a **new family**: pre-registered grid, subject to
  §7.4 unchanged, counts toward the N ≤ 45 cap (C5).
- Its **LLM-off twin** is the same strategy with the feature input held
  constant, run on the **identical dates** — forward, paper, ≥ 3 months, per
  hard rule 2.
- **Comparison statistic:** paired difference in per-trade net return between
  twin and original, on the same dates; report the paired mean, its 95% CI,
  and the count. **No claim of improvement below 100 paired trades** (§7.4's
  floor applies to the pair). Reason: paired on dates removes the market from
  the comparison; anything else compares two regimes, not two strategies.
- The 12-month holdout does not apply (features do not exist there). The
  forward window IS the holdout, and it is evaluated once.

## 7. Failure isolation *(the mirror rule, applied)*

- The analyst is a separate NestJS service, called fire-and-forget from the
  events above; the trading loop **never awaits it**.
- Every error — API, timeout (30 s), schema, cap — is caught and journaled as
  `ops/analyst-error` with the trigger and a truncated message. It cannot
  throw into the loop, cannot delay a tick, cannot touch `paper_account`.
- API key in `.env` only, read-only scope on the Anthropic side (no admin),
  never logged. Same handling as the exchange keys (AGENTS.md safety rules).
- `ENABLE_LLM_ANALYST=true` gates the whole service; default off. Ships off;
  the human turns it on after the soak.

## 8. Kill switch and halts

- Kill switch **on** → analyst writes one `kill-switch` row and then makes no
  calls until it is off. Reason: it is a spend, and a halted account has
  nothing to review.
- Stale-data halt → one row, then silence until data resumes.
- The analyst has no write path to the kill switch, the loop, or the broker.
  Hard rule 1 (§2.5) is structural, not a prompt instruction.

## 9. What a successful Phase 4 looks like in REPORT

A §13, "AI in the loop, honestly": the integration works; N unchanged; `k`
rows over `d` days; cost `$x`; zero analyst errors reached the loop; a sample
of commentary next to what actually happened; and the sentence *"no strategy
consumed these features, so this project makes no claim about whether they
help — the forward clock started on <date>."* That sentence is the deliverable.

## Amendments

*(none yet — append below with date and reason; never edit above)*

### Amendment 1 — 2026-09-25, before any LLM call (featureVersion 1 unchanged: no call has run under the original text)

1. **Model: `claude-opus-5` → `claude-opus-5-5`.** Human decision, 2026-09-25.
   Same Opus line, list price $5 / $25 → **$4 / $20** per MTok; budget in §5
   falls accordingly. Opus 5.5's thinking cannot be disabled and its default
   effort is `medium`; `effort: "medium"` stays pinned explicitly. **No refusal
   fallback is configured**: a fallback would silently change the model inside
   the series and break §4's provenance — a refusal is journaled as
   `ops/analyst-error` instead.
2. **Output cap: 1.5k → `max_tokens` 4,000.** Adaptive thinking tokens count
   toward `max_tokens`; at 1.5k a `medium`-effort reply risks `max_tokens`
   truncation, which under structured outputs is an error, not a shorter note.
   Worst case at the 50-call/day cap: 50 × (8k × $4 + 4k × $20)/1M ≈ $5.6/day;
   expected ~40 calls/month ≈ $1–3/month. The ≤ 8k input cap and ≤ 50 calls/UTC
   day are unchanged and enforced in code (`countTokens` before every call).
3. **Timeout: 30 s → 60 s, no retries.** The 30 s figure protected the loop;
   the loop no longer waits on the analyst at all (item 4), so the timeout only
   bounds spend and staleness.
4. **Mechanism of "fire-and-forget" (§7):** the loop does not call the
   analyst. The analyst polls the journal every 5 minutes for the trigger rows
   the loop already writes (`fill`, `risk`, `ops/kill-switch`,
   `ops/stale-data-halt`), so the trading loop has no reference to it and no
   code in the loop changed. Stricter than §7, not looser. Fill reviews land
   ≤ 5 min after the fill instead of immediately.
5. **Kill switch (§8) rows are markers, not calls:** `ops/analyst-paused` /
   `ops/analyst-resumed`. A stop fill produced by the kill switch itself
   (`kill-switch flatten`) is not reviewed.
6. **Inputs (§2) in v1:** BTC/USDC only (the universe is permitted, not
   required); 30 days of closed 4h candles, the channel bounds, the account row,
   the triggering row, and 30 days of `fill`/`risk` rows.


### Amendment 2 — 2026-09-25, before any Jev call: TypeSafe guardrail on analyst rows

Human decision 2026-09-25 (key provisioned as `TYPESAFE_API_KEY`). Adds a
**check on the analyst, not a feature**: nothing reads it, it never blocks,
edits or re-asks the analyst — re-asking until a check passes would be exactly
the output selection §4 forbids.

- After every `kind='analyst'` row, one TypeSafe System One call, model
  **pinned `jev-1.13.0`** (the `jev-latest` alias moves on release). State =
  the analyst's `regime` / `commentary` / `review` plus the exact `inputs` it
  was given. Three yes/no questions (Noul), fixed text in
  `apps/agent/src/analyst/analyst.service.ts` `CHECKS`, hashed on every row:
  `predictsPrice`, `recommendsTrade` (both forbidden by the system prompt and
  §0) and `contradictsInputs`.
- Journaled as `kind='analyst-check'` with the three probabilities, the served
  model id, `questionsHash`, input tokens and cost ($0.042/MTok input, output
  free — ~$0.0003 per check). Failures → `ops/analyst-check-error`.
- **No threshold is set now and none will be tuned on this data.** The
  probabilities are reported as-is in REPORT §13; a human reading a flagged row
  decides. Question text counts against §4's cap of ≤ 3 versions, separately
  from the analyst prompt.
- Integration smoke test on two synthetic analyses (not journaled, not part of
  the series) is permitted to verify wiring; its numbers are not used for
  anything.

### Amendment 3 — 2026-09-28: the Phase 4 window is fixed at 30 days, ending 2026-10-25 17:05Z

Human decision 2026-09-28, written three days into the forward clock and
**before any analysis of the analyst output** (three daily notes exist; none
has been scored, compared or selected on).

- **Why the length was open.** §0 never pinned a duration for Phase 4 itself.
  "≥ 3 months" belongs to §6 / SPEC §2.5 — the forward evaluation of an
  LLM-*using* strategy against its LLM-off twin — which V1 does not run. The
  §9 deliverable ("the integration works; k rows over d days; cost; zero
  analyst errors reached the loop; the forward clock started on <date>")
  does not require three months, and was being read as though it did.
- **Window:** 2026-09-25 17:05:00Z (`analyst-started`, journal #11890) →
  **2026-10-25 17:05:00Z**, 30 days — the soak's scale, and it coincides
  with the next kill-switch drill. Fixed now so it cannot be chosen after
  seeing how the notes look. REPORT §13 is written from rows inside the window
  only; a missed daily note inside it is reported as missed, never backfilled.
- **Not changed:** cadence (daily 06:10Z + event triggers), model, prompt,
  caps, guardrail. The analyst keeps running after the window closes; later
  rows are outside §13's population and are not added to it.
- **Still not claimed:** anything about whether AI helps (§0, §6). Shortening
  the window changes nothing there — V1 never makes that claim.
