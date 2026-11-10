# V2 Funding-Rate Carry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-register, backtest on dev, and evaluate once on the holdout a BTC spot-long / perp-short funding carry, ending in a PASS/FAIL verdict in REPORT.

**Architecture:**
- The carry engine and its metrics are pure functions in `packages/core/src/carry.ts`, so the forward paper loop can reuse them later.
- The agent gets a `funding_rates` table, one backfill CLI, and three carry CLIs: preregister, dev run and holdout verdict.
- The carry registry lives in a new file. V1's `ExperimentService`, `FACTORIES`, `preregister` and `run-holdout` are not modified.
- **Out of scope:** the forward paper loop (spec §8). It gets its own plan, and only after a holdout PASS.

**Tech Stack:** TypeScript, vitest (core), NestJS application context CLIs, Drizzle/Postgres, ccxt `bybit`.

**Spec:** `docs/superpowers/specs/2026-11-10-v2-funding-carry-design.md`

## Global Constraints

- Never touch `experiments/{sma-crossover,rsi-reversion,donchian-breakout,universe}.json`, `experiment.service.ts`, `run-holdout.ts`, `preregister.ts`, the trading loops or the D4 shadow loop.
- Family name `funding-carry`. Perp symbol in ccxt: `BTC/USDC:USDC` (Bybit `BTCPERP`, verified 2026-11-10). Spot: `BTC/USDC`.
- Costs: spot fee 0.001, perp fee 0.00055 (replace with the published figure if Task 1 finds a different one), slippage 0.0003 per side per leg.
- Capital `C` = 10,000. Spot gets `C/2` and perp margin gets `C/2`, so the position is 1× leveraged with equal BTC quantity on each leg.
- Dev window: 2022-01-14T00:00Z → `HOLDOUT_FROM` (2025-08-01, exclusive).
- Holdout window: 2025-08-01 → 2026-08-01, exclusive.
- APR annualisation: `mean rate × 3 × 365`. Net APR is simple: `(final/C − 1) × 365.25 / days`.
- Pass criteria use these exact values: net APR > 0.04; beats C1 on net APR (gated only); best-month share < 0.5; max drawdown < 0.05.
- Trial cap: pooled distinct configs ≤ `MAX_TOTAL_CONFIGS` (45). N goes 34 → 38.
- Only one holdout evaluation is allowed, across all families. Refuse if any `holdout-evaluation` row exists.
- Ops: do not run root `pnpm build` or `pnpm test` while the dashboard dev server is up. Use `pnpm --filter @microtrading/core test` and the agent `tsc`.
- Never read `apps/agent/.env`.

## Review Focus

1. **Funding sign.** A positive rate pays the short, so carry gains; a negative rate costs it. → Task 2, `carry pays the short on positive funding and charges it on negative`.
2. **No lookahead.** A decision at settlement `S` uses only prints with `ts ≤ S`, and a print after `S` never changes it. → Task 2, `signal ignores prints after the decision time`.
3. **Holes in the data.** A missing perp or spot bar, or a missing funding print, is skipped and counted, never interpolated. → Task 2, `skips bars missing either leg and counts them`.
4. **Open at window end.** The final equity closes both legs at the last bar with full exit costs, so an always-on config is not flattered. → Task 2, `closes an open position at the window end with exit costs`.
5. **A second holdout run.** The verdict CLI refuses if any family already has a `holdout-evaluation` row. → Task 4, `assertHoldoutUnspent throws when any family has a holdout row`.

---

### Task 1: D5 deviation, grid file, fee check

**Files:**
- Modify: `SPECIFICATION.md`, appended at the end of §7.5 after the last deviation entry (find it with `grep -n "^\*\*D4" SPECIFICATION.md`).
- Create: `experiments/funding-carry.json`

- [ ] **Step 1: Verify the perp fee.** Read Bybit's published fee page (non-VIP derivatives taker). Write the figure and the URL into D5. If it isn't 0.055%, use the published number everywhere this plan says 0.00055.
- [ ] **Step 2: Append D5 to SPEC §7.5.** Dated 2026-11-10, human decision. It records:
  - the new family `funding-carry`, 4 configs, N 34 → 38;
  - that V2 spends the single C4 holdout evaluation, on the window 2025-08-01 → 2026-07-31, for one config plus C1 as a benchmark;
  - the pass criteria from the design §7;
  - that real money is out of scope (design §9).

  Link the design doc.
- [ ] **Step 3: Write `experiments/funding-carry.json`.** Use the same shape as `donchian-breakout.json`, with `"family": "funding-carry"` and a `_note`. The grid is exactly:
  ```json
  [{ "k": 0, "enterApr": 0, "exitApr": 0 },
   { "k": 21, "enterApr": 0.10, "exitApr": 0 },
   { "k": 21, "enterApr": 0.20, "exitApr": 0.05 },
   { "k": 63, "enterApr": 0.10, "exitApr": 0 }]
  ```
  `k: 0` means always on (C1). The order is C1..C4.
- [ ] **Step 4: Commit.** `git add SPECIFICATION.md experiments/funding-carry.json docs/superpowers && git commit -m "D5: register V2 funding-carry design and grid (human-approved 2026-11-10)"`

### Task 2: Carry engine in core

**Files:**
- Create: `packages/core/src/carry.ts`
- Modify: `packages/core/src/index.ts`, adding `export * from './carry.js';`
- Test: `packages/core/test/carry.test.ts`

**Interfaces — Produces:**
```ts
export interface FundingPrint { ts: number; rate: number }            // rate per 8h, fraction
export interface CarryBar { ts: number; spotOpen: number; spotClose: number; perpOpen: number; perpClose: number }
export interface CarryParams { k: number; enterApr: number; exitApr: number } // k = 0 → always on
export interface CarryCosts { spotFee: number; perpFee: number; slippage: number }
export const CARRY_COSTS: CarryCosts  // { spotFee: 0.001, perpFee: 0.00055, slippage: 0.0003 }
export interface CarryRun {
  equity: { ts: number; equity: number }[];  // per bar, marked to market both legs
  finalEquity: number; roundTrips: number; rebalances: number;
  fundingEarned: number; costsPaid: number; barsInMarket: number; barsSkipped: number;
}
export function joinBars(spot: Candle[], perp: Candle[]): { bars: CarryBar[]; skipped: number }
export function trailingApr(funding: FundingPrint[], atTs: number, k: number): number | null
export function runCarry(bars: CarryBar[], funding: FundingPrint[], p: CarryParams,
  costs: CarryCosts, capital: number, fromTs: number, toTs: number): CarryRun
```

Semantics, from the spec; the implementer writes the bodies:
- **Settlements:** a settlement is any funding print with `fromTs ≤ ts < toTs`. `trailingApr` is the mean of the last `k` prints with `ts ≤ atTs`, × 1095. It returns null if fewer than `k` exist; prints before `fromTs` are valid warmup.
- **Trading at a settlement:** at each settlement, act on the first bar with `bar.ts ≥ S`:
  - Flat and (`k === 0` or apr > enterApr): open.
  - In and `k > 0` and apr < exitApr: close.
  - `k === 0` opens at the first bar and never exits before window end.
- **Funding:** at each settlement while the position was open before `S`, add `rate × qty × perpOpen(bar at S)` to equity. Do this before any close at `S`.
- **Fills:**
  - Open: spot buy at `spotOpen × (1+slip)`, fee `spotFee × notional`. Perp short at `perpOpen × (1−slip)`, fee `perpFee × notional`.
  - `qty = (C_now/2) / spotFill`, with the same qty on both legs.
  - Close: reverse both legs with the same costs.
- **Rebalance:** if `perpClose ≥ 1.5 × perpEntry` while in, close both legs and reopen at the next bar's opens (full costs). Count it in `rebalances`, not `roundTrips`. *Plan call: a full close/reopen is more pessimistic than a partial spot sale, and simpler.*
- **Window end:** an open position closes at the last bar's close prices, with costs.

- [ ] **Step 1: Write the failing tests** in `carry.test.ts` using small synthetic series with flat prices of 100 unless stated:
  - `carry pays the short on positive funding and charges it on negative`: k=0, three prints of +0.001 then three of −0.001. `fundingEarned` ≈ 0 and its sign path is right. A run with only +0.001 prints has `fundingEarned` ≈ `3 × 0.001 × qty × 100`.
  - `signal ignores prints after the decision time`: `trailingApr(f, S, 3)` is identical whether or not a huge print at `S+1` exists.
  - `enters above enterApr and exits below exitApr`: k=1, enter 0.10, exit 0. Prints give APR 0.2, 0.2, −0.1. Expect `roundTrips === 1` and in-market bars between settlement 1 and 3.
  - `charges both legs' fees and slippage on a round trip`: flat prices, no funding, k=0. `C − finalEquity` ≈ `2 × (C/2) × (0.001+0.0003) + 2 × (C/2) × (0.00055+0.0003)` (within 0.5%).
  - `is price-neutral`: k=0, prices double from open to close with zero funding. `finalEquity` is within the costs bound of the previous test, plus the rebalance cost.
  - `rebalances when perp rises 50% above entry`: `rebalances === 1`.
  - `skips bars missing either leg and counts them`: `joinBars` with one spot ts missing gives `skipped === 1`, and that ts is not in `bars`.
  - `closes an open position at the window end with exit costs`: k=0 equals the round-trip cost test above.
- [ ] **Step 2:** `pnpm --filter @microtrading/core test -- carry`. Expect FAIL (module not found).
- [ ] **Step 3:** Implement `carry.ts` to the interfaces and semantics above.
- [ ] **Step 4:** `pnpm --filter @microtrading/core test`. Expect all to pass (45 existing + the new ones).
- [ ] **Step 5: Commit.** `feat(core): funding-carry engine (V2, D5)`

### Task 3: Carry metrics and verdict in core

**Files:**
- Modify: `packages/core/src/carry.ts`
- Test: `packages/core/test/carry.test.ts`

**Interfaces — Produces:**
```ts
export interface CarryMetrics {
  netApr: number; maxDrawdownPct: number /* fraction */; worst30dReturn: number;
  bestMonth: string | null; bestMonthShare: number /* NaN if net ≤ 0 */;
  byYear: { year: string; ret: number }[]; timeInMarket: number /* fraction of bars */;
  fundingEarned: number; costsPaid: number; roundTrips: number; rebalances: number; days: number;
}
export function carryMetrics(run: CarryRun, capital: number): CarryMetrics
export interface Criterion { name: string; pass: boolean; detail: string }
export function carryVerdict(chosen: CarryMetrics, c1: CarryMetrics | null): { pass: boolean; criteria: Criterion[] }
export function pickDevBest(results: { params: CarryParams; m: CarryMetrics }[]): number  // index; max netApr, tie → lowest index
```

- [ ] **Step 1: Write the failing tests.**
  - `netApr annualises simple return over the run's days`: equity 10,000 → 10,400 over 365.25 days gives 0.04.
  - `max drawdown is peak-to-trough on marked equity`: equity [100, 110, 99, 120] gives 0.1.
  - `best-month share is NaN when net is not positive`.
  - `verdict fails at exactly 4% APR and passes above it`.
  - `verdict marks the C1 comparison not applicable when c1 is null`: the criteria list has no `beats C1` entry, or it is marked pass with detail `n/a`.
  - `pickDevBest breaks ties toward the lower index`.
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement. Months are UTC `YYYY-MM` of the bar ts. Monthly P&L is month-end equity minus the previous month-end.
- [ ] **Step 4:** `pnpm --filter @microtrading/core test`. Expect all to pass.
- [ ] **Step 5: Commit.** `feat(core): carry metrics, verdict and dev-best rule`

### Task 4: Funding data, registry, and the three CLIs

**Files:**
- Modify: `apps/agent/src/db/schema.ts`, adding the table below.
- Create:
  - `apps/agent/src/experiments/carry-registry.ts`
  - `apps/agent/src/cli/backfill-carry.ts`
  - `apps/agent/src/cli/preregister-carry.ts`
  - `apps/agent/src/cli/run-carry.ts`
  - `apps/agent/src/cli/carry-verdict.ts`
- Modify: `apps/agent/package.json` scripts: `backfill-carry`, `preregister-carry`, `run-carry` and `carry-verdict`, in the same `node --env-file=.env dist/cli/<name>.js` form.
- Test: `packages/core/test/carry.test.ts` covers the pure guard below, kept in core so vitest runs it.

**Interfaces:**
- Consumes: Task 2/3 exports; `HOLDOUT_FROM`, `MAX_TOTAL_CONFIGS`, `paramsHash`, `ExperimentService.countDistinctConfigsAllFamilies()` (read-only use); `IngestionService.backfill(symbol, sinceIso, 'bybit')`; `CandleRepository.fetchSince`.
- Produces:
  ```ts
  // schema.ts
  export const fundingRates = pgTable('funding_rates', {
    symbol: text('symbol').notNull(), ts: bigint('ts', { mode: 'number' }).notNull(),
    rate: doublePrecision('rate').notNull(), source: text('source').notNull(),
  }, (t) => [primaryKey({ columns: [t.symbol, t.ts] })]);
  // core carry.ts (pure, testable)
  export function assertHoldoutUnspent(holdoutRows: { strategyFamily: string }[]): void // throws naming the family
  ```

- [ ] **Step 1: Write the failing test.** `assertHoldoutUnspent throws when any family has a holdout row`: `[]` does not throw; `[{ strategyFamily: 'donchian-breakout' }]` throws with a message containing `donchian-breakout`. Run it and expect FAIL. Implement it in core, run it and expect PASS.
- [ ] **Step 2: Add `fundingRates`, then run `pnpm --filter @microtrading/agent db:push`.** This change is additive. Then verify with `\d funding_rates` via the psql command in CLAUDE.md.
- [ ] **Step 3: Write `backfill-carry`.**
  - Perp candles: `ingestion.backfill('BTC/USDC:USDC', '2022-01-14T00:00:00Z', 'bybit')`. They are stored under their own symbol, so V1 queries on `BTC/USDC` are untouched.
  - Funding history: page with ccxt `fetchFundingRateHistory('BTC/USDC:USDC', since, 200)` and upsert into `funding_rates` with `source 'bybit-rest'`. The call is idempotent.
  - Print the row count, the first and last ts, and the number of gaps where consecutive prints are more than 8h apart.
  - **Expected:** about 5,284 prints with the earliest at 2022-01-14 08:00Z, and perp 1h candles from 2022-01-14.
- [ ] **Step 4: Write `carry-registry.ts` and `preregister-carry`.**
  - Read `experiments/funding-carry.json`.
  - Refuse if a `funding-carry` preregistration row already exists.
  - Refuse if `countDistinctConfigsAllFamilies() + 4 > MAX_TOTAL_CONFIGS`.
  - Insert a `preregistration` row with payload `{ grid, holdoutFrom: HOLDOUT_FROM, holdoutTo: Date.UTC(2026,7,1), costs: CARRY_COSTS }` and the git sha. Use the same `gitSha()` approach as `experiment.service.ts`, copied rather than imported, because it isn't exported.
  - Run it. Expect a success line.
- [ ] **Step 5: Write `run-carry` for dev only.**
  - Load spot 1h, perp 1h and funding up to `HOLDOUT_FROM`. **The query bound is `< HOLDOUT_FROM`, so it never reads holdout data.**
  - Run all 4 configs and log each as a `trial` row (`strategyFamily 'funding-carry'`, `paramsHash(params)`, payload = metrics).
  - Print a table with id, params, net APR, max DD, time in market, funding, costs, best-month share and by-year.
  - Print `N = <countDistinctConfigsAllFamilies()>`.
  - Print the dev-best id (`pickDevBest`) and the **dev kill**: if every config has net APR ≤ 0, print `DEV KILL — V2 stops; holdout not spent` and exit 0.
- [ ] **Step 6: Write `carry-verdict`. Do not run it yet.**
  - Call `assertHoldoutUnspent` over all `holdout-evaluation` rows.
  - Recompute the dev-best from the logged dev trial rows, not by hand.
  - Run it on the holdout window, warming up on funding prints before 2025-08-01. If it is gated, also run C1.
  - Insert a `holdout-evaluation` row with family `funding-carry`, the chosen params and both metrics.
  - Print `carryVerdict` per criterion and `PASS`/`FAIL`, plus N.
- [ ] **Step 7:** Typecheck with `cd apps/agent && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`, then build the agent with `pnpm --filter @microtrading/agent build`.
- [ ] **Step 8: Commit.** Commit before any dev run: `feat(agent): funding-carry data, registry and CLIs (verdict written before the holdout)`
- [ ] **Step 9: Run in order.**
  1. `pnpm --filter @microtrading/agent backfill-carry`
  2. `preregister-carry`
  3. `run-carry`

  Paste the output into WORKLOG and expect N = 38.
- [ ] **Step 10: Stop on a dev kill.** If `run-carry` printed DEV KILL, skip Task 5's holdout run and write REPORT §14 as a dev-stage null. Otherwise continue.

### Task 5: Holdout, once — then report

**Files:**
- Modify: `docs/REPORT.md` (new §14 "V2: funding carry" before Appendix A), `docs/WORKLOG.md`, `AGENTS.md` (operational state: V2 status, N = 38, holdout SPENT)

- [ ] **Step 1:** `git status` must be clean, with `carry-verdict` already committed (Task 4 Step 8).
- [ ] **Step 2:** `pnpm --filter @microtrading/agent carry-verdict`. **This runs once.** Save the full output to WORKLOG verbatim.
- [ ] **Step 3: Write REPORT §14.** It covers:
  - the question;
  - the D5 reference;
  - the dev table;
  - the chosen config and why (the rule);
  - the holdout criteria with PASS/FAIL;
  - funding vs cost decomposition;
  - concentration;
  - N = 38;
  - the real-money gate (design §9).

  Quote the experiment row ids.
- [ ] **Step 4: Update AGENTS.md.** The holdout is spent, so no family can be holdout-evaluated again. State V2's status and point to §14.
- [ ] **Step 5: Commit.** `V2 funding-carry: holdout evaluated once — <PASS|FAIL>; REPORT §14`
- [ ] **Step 6:** On PASS, the next step is a new brainstorm and plan for the forward paper `CarryLoopService` (design §8). On FAIL, V2 is closed as a reported null.
