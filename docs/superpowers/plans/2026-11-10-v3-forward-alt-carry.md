# V3 Forward Alt-Carry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Pre-register and run a 6-month forward paper carry (K1 always-on, K2 7-day funding gate) on the ten universe coins in USDT markets, with a live dashboard card and a pre-written verdict CLI.

**Architecture:**
- Pure core additions in `packages/core/src/carry.ts`: a time-window signal and pooling of per-coin runs.
- The agent's `CarryForwardService` (cron at :09) ingests 20 symbols and journals a `carry-forward` snapshot.
- Supporting pieces: the read-only `/api/carry-forward` endpoint, a dashboard card, a generalised `preregister-carry`, and a `v3-carry-verdict` CLI.

**Spec:** `docs/superpowers/specs/2026-11-10-v3-forward-alt-carry-design.md`

## Global Constraints

- Coins come from `experiments/universe.json`. Spot symbol `X/USDT`, perp symbol `X/USDT:USDT` (ccxt). The V2 symbols and code paths are unchanged.
- Costs are `CARRY_COSTS` (0.001 / 0.00055 / 0.0003). Each coin has 10,000 USDT, so each config has 100,000 pooled.
- K1 `{k:0, enterApr:0, exitApr:0}`. K2 `{k:21, enterApr:0.1, exitApr:0, windowDays:7}`.
- Window: start = the first 00:00Z after registration, end = start + 6 calendar months. Both are stored in the registration row.
- Pass: pooled net APR > 0.04; best month < 0.5; max DD < 0.05; K2 must also beat K1.
- N 38 → 40 at registration; trial rows are written then.
- Push only between :10 and :55 UTC, because a push auto-deploys to Railway.

## Review Focus

1. **Interval change:** a coin moving from 8 h to 1 h prints keeps a 7-day signal. → T2 `trailingAprWindow handles mixed 8h/1h spacing`.
2. **Delisted coin:** its equity carries forward as cash in the pool. → T2 `poolRuns carries a coin's last equity forward`.
3. **Snapshot before start:** the endpoint and card report "not started" and show no numbers. → T3, the service skips work before the start.
4. **Verdict before end:** prints INTERIM and writes nothing. → T3 CLI.
5. **One symbol failing ingestion:** the others still ingest, and the snapshot still writes. → T3, per-symbol try/catch.

### T1: D6 + grid file
- [ ] Append D6 to SPEC §7.5 (human-approved 2026-11-10), summarising design §1–5 and linking it. Create `experiments/funding-carry-v3.json`: `{family: "funding-carry-v3", forward: true, months: 6, grid: [K1, K2]}`. Commit.

### T2: Core: window signal + pooling (TDD)
- `CarryParams.windowDays?: number`. When it is set, `runCarry` uses `trailingAprWindow` in place of `trailingApr`.
- `trailingAprWindow(funding, atTs, windowMs): number | null`: the mean of prints in `(atTs − windowMs, atTs]` × (365 d / median spacing). Returns null if there are fewer than 2 prints.
- `poolRuns(runs: CarryRun[]): CarryRun`: the union of timestamps, with each run's last equity carried forward (and its starting capital before its first point). Sums finalEquity, funding, costs, trips, rebalances and barsInMarket.
- Tests:
  - `trailingAprWindow matches trailingApr at 8h spacing`
  - `trailingAprWindow handles mixed 8h/1h spacing`
  - `trailingAprWindow returns null with no prints in window`
  - `poolRuns sums equity across coins`
  - `poolRuns carries a coin's last equity forward`
- Commit.

### T3: Agent
- `carry-registry.ts`:
  - `v3Symbols(): {coin, spot, perp}[]`
  - `ingestFunding(db, ex, perp, since)`, moved out of `backfill-carry`
  - `loadPair(dbs, repo, spot, perp, fromTs, toTs)`
  - `v3Snapshot(dbs, repo, reg, nowTs)`, which returns per-coin and pooled metrics for K1 and K2
- `preregister-carry` takes an optional grid file argument. For `forward` grids it computes startTs/endTs and writes the preregistration row plus one `trial` row per config.
- `CarryForwardService`, a TradingModule provider:
  - `@Cron('9 * * * *')`, gated by `ENABLE_CARRY_FORWARD === 'true'` and a v3 registration.
  - Ingests from `startTs − 8d` per symbol, with a try/catch around each one.
  - After the start, journals `{kind:'carry-forward', payload: snapshot}`.
- `GET /api/carry-forward`: the latest snapshot plus the registration dates (state: unregistered, pending or running).
- `v3-carry-verdict` CLI: before `endTs` it prints INTERIM only. At or after `endTs` it prints `carryVerdict` for K1 (vs null) and for K2 (vs K1), and writes one `evaluation` row. It refuses if that row exists.
- Typecheck, build, commit.

### T4: Dashboard card
- `api.carryForward()` and a card next to the shadow card. It shows K1 and K2 pooled equity vs 100,000, net APR so far, funding and costs, coins in market, start/end dates and "INTERIM — not the verdict". Commit.

### T5: Ship
- Push in a safe minute, then set `ENABLE_CARRY_FORWARD=true`.
- Run `railway ssh --service agent -- node dist/cli/preregister-carry.js experiments/funding-carry-v3.json`, then confirm N = 40 and the start date.
- Update AGENTS.md and WORKLOG.
- After the first post-start :09, verify a snapshot row and the card.
