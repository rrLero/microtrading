# V2 — BTC funding-rate carry: design

**Status:** draft for approval, 2026-11-10. Nothing is built until the human approves this.

## 1. Intent — why this, why now

V1 asked "can a price-direction rule beat honest costs?" The answer it is heading to is
no: the backtest edge is essentially one month (2024-11, REPORT §1.1), and the forward
shadow run is 0 wins in 10 round trips. The owner's goal for the project is to **make
money with it or sell it**. Neither works on a forecast that has no edge.

V2 asks a different question, one that needs no forecast:

> **Does holding spot BTC and shorting the same quantity of the BTC perpetual, on Bybit,
> earn a positive return on capital after every cost, out of sample — and is that return
> worth more than parking the same USDC in a low-risk yield?**

Perpetual futures pay *funding* every 8 h: when the perp trades above spot, longs pay
shorts. A spot-long / perp-short position is price-neutral and collects that payment.
This is a known, structural premium (crowded leveraged longs pay it). The open
questions are size, persistence, and whether fees, basis moves and negative-funding
stretches eat it. That is checkable on ~4.8 years of public data in weeks, not in 2028.

A V2 that works also serves the "sell it" route. The sellable thing is the rigour: a
pre-registered, cost-honest research and paper harness. A second, different strategy
running through the same harness proves the harness is general.

## 2. Goals, non-goals, anti-goals

**Goals**
1. Pre-register a small carry rule grid before computing any carry statistic.
2. Backtest it on dev data with the same code the paper loop runs (SPEC §4.1).
3. Evaluate the holdout exactly once, against a pre-written verdict script.
4. If the holdout passes, run a forward paper carry account alongside V1, untouched by it.
5. Report the result honestly in a V2 section of REPORT, whatever it is.

**Non-goals (this design)**
- Real money, demo orders, or any order to any venue. Paper only.
- Assets other than BTC; other venues; leverage above 1×; borrowing.
- Combining carry with V1's Donchian signal; any LLM in the loop.
- Productising or selling anything (a later, separate decision).

**Anti-goals: it fails even if it "works" when any of these happen**
- Thresholds are tuned after looking at funding data, or on the holdout.
- The headline number comes from 2021-style funding conditions, or from one month. The
  concentration test applies, as in SHADOW-PREREG §2.
- The return is quoted on the perp notional instead of on the total capital tied up.
- V1's loops, grids, holdout, or D4 shadow run are changed in any way.

## 3. Constraints (binding)

- **V1 is frozen and keeps running.** Do not touch `experiments/*.json`, holdout tooling,
  §7 enforcement, the BTC loop, or the D4 shadow loop. V2 is additive.
- **Trial accounting:** V2 draws from the existing total budget. `MAX_TOTAL_CONFIGS = 45`
  (C5) and N is 34, so 11 are left. The V2 grid is **4 configs → N = 38**. Registering a
  new family is a logged deviation: write SPEC §7.5 **D5** first (human decision), then
  run `preregister`. Every V2 report prints N.
- **One code path:** carry logic lives in `packages/core` (framework-free). The backtester
  and the paper loop call the same functions.
- Journal append-only; UTC epoch ms; decisions only on closed candles / settled funding.
- **Paper isolation:** carry rows are `carry-*` and the carry account is its own
  `paper_account` row. It is never mirrored to demo. The kill switch halts it too. It is
  not a second loop on an existing account, so the "two loops" rule is not violated, but
  it must still never run twice (terminal plus Docker).

## 4. Data (verified 2026-11-10)

- **Perp:** Bybit `BTCPERP`, a USDC-settled linear perpetual. The account currency is
  already USDC, so no USDT conversion is needed. Listed 2021-01-14. Funding interval is
  480 min (00/08/16 UTC). Funding history via public
  `GET /v5/market/funding/history?category=linear&symbol=BTCPERP`, **5,284 rows from
  2022-01-14 08:00Z**. Perp 1h klines via `/v5/market/kline?category=linear`.
- **Spot:** Bybit `BTC/USDC` 1h candles, already ingested for V1.
- **Disclosure:** while checking the API, the three latest funding prints were seen
  (0.003–0.009% per 8 h, 2026-11-09). No average, distribution or backtest was computed
  before this design was written.

## 5. The rule and grid (pre-registered at D5; written here before any statistic)

**Position:** capital `C` USDC (paper: 10,000). Buy spot BTC with `C/2`. Post `C/2` as
perp margin and short the same BTC quantity, so leverage is 1× and liquidation only
happens near a ~+100% BTC move. Return is always quoted on `C`.

**Signal:** `F̄` is the trailing mean of the last `k` settled funding prints, annualised
(×3×365).
- **Enter** (when flat) at the next 1h open after a settlement where `F̄ > enter`.
- **Exit** at the next 1h open after a settlement where `F̄ < exit`.
- Both legs are opened and closed in the same bar.

**Grid (4 configs):**

| id | k (prints) | enter (APR) | exit (APR) |
|----|-----------|-------------|------------|
| C1 | — | always on (enter once, never exit) | — |
| C2 | 21 (7 d) | 10% | 0% |
| C3 | 21 (7 d) | 20% | 5% |
| C4 | 63 (21 d) | 10% | 0% |

C1 is the baseline: the dumbest version of the premium. If the gated rules do not beat
it, gating is noise.

**Rebalance (all configs, not a parameter):** if mark price is 1.5× the perp entry
price (margin ratio about to bite), sell spot BTC to restore 1× margin and reduce both
legs equally. Each rebalance pays full costs.

## 6. Cost model (pessimistic, like §6.2)

- **Spot leg:** 0.10% taker plus the measured BTC/USDC half-spread (sampled hourly since
  2026-08, p90 is below the 0.03% floor), so floor slippage is **0.03%** per side.
- **Perp leg:** **0.055%** taker (Bybit published non-VIP derivatives rate; *verify
  against the live fee page before D5*) plus 0.03% slippage per side.
- **Basis:** the legs fill at their own venue prices (spot open vs perp open of the same
  bar). The entry/exit basis difference is real P&L and is kept, not netted away.
- **Funding:** at each settlement while open, P&L += `rate × perp notional at mark`
  (positive rate pays the short; negative rate costs it).
- **Not modelled (stated):** USDC idle yield on margin; spot borrow (none); exchange
  default risk. Maker orders are a later cost study, not this design.

## 7. Evaluation

- **Splits:** dev 2022-01-14 → 2025-07-31; holdout **2025-08-01 → 2026-07-31** (12
  months), exactly C4's frozen boundaries. Data after 2026-08-01 is the soak and is not
  used. No date is chosen after seeing anything. *(Builder-check: my call, follows C4.)*
- **The one holdout evaluation.** C4 allows one holdout evaluation in total, across all
  families. V1 never spent it (REPORT §1.2), so **V2 spends it**, and that needs the
  human's D5 decision. It is one run, of one pre-named config: the dev-best by net APR
  on `C`. If that config is gated (C2–C4), the same run also prints C1 as a pre-named
  benchmark for criterion 2. A benchmark is not a selection; nothing is chosen from the
  holdout output.
- **Metrics (per config, on `C`):** net APR; total funding earned; total costs; max
  drawdown (marked to market, both legs); % of time in market; number of round trips and
  rebalances; worst 30-day return; best-month share of net (concentration); per calendar
  year.
- **Pass criteria (holdout, all must hold):**
  1. Net APR on `C` > **4%**, a stand-in for low-risk USDC yield. Anything less is not
     worth the exchange and operational risk.
  2. If the chosen config is gated, its holdout net APR > C1's holdout net APR. If C1 is
     itself the dev-best, this criterion does not apply.
  3. Best month < 50% of net.
  4. Max drawdown < 5% of `C`.
- **Kill (dev):** if no config has dev net APR > 0, V2 stops at the dev stage and REPORT
  says so. The holdout is not spent.
- **Verdict script** (like `shadow-verdict`) is written and committed **before** the
  holdout run and prints PASS/FAIL per criterion.

## 8. Forward paper (only after a holdout PASS)

A `CarryLoopService` runs the chosen config on a fresh 10,000 USDC paper account:
- It ticks after each funding settlement (:05 past 00/08/16 UTC) and on hourly closed bars.
- It reads live funding and perp/spot prices read-only.
- It journals `carry-decision`, `carry-fill` and `carry-funding` rows.

The dashboard gets a carry card: equity, funding earned, basis, in/out. Verdict at 6
months forward, using the same criteria. The paper run is the only evidence that counts
toward real money.

## 9. The real-money gate (out of scope; recorded so nobody forgets)

**Likely blocker:** the owner trades from the EU, and Bybit EU (MiCA) appears to be
**spot-only**. ESMA (Feb 2026) treats crypto perps as CFDs under MiFID II, with a 2:1
retail leverage cap; 1× carry fits under it. Real money therefore needs a
MiFID-licensed EU perp venue, for example One Trading, and that venue's own funding
history, fees and basis. Bybit's figures are the research proxy, not the venue. Before
real money, all three are required:
1. A forward-paper PASS.
2. A venue confirmed legal for the owner, with its costs re-modelled.
3. An explicit human decision, logged.

SPEC §9 custody prerequisites apply.

## 10. Build order (for the plan)

1. SPEC §7.5 D5 text + `experiments/funding-carry.json` (4 configs) — human approves, commit.
   **Separate carry-only `preregister-carry` and `run-carry-holdout` CLIs**; V1's
   `preregister` / `run-holdout` / `FACTORIES` stay untouched. The carry tools write the
   same `experiments` table, enforce the same `MAX_TOTAL_CONFIGS = 45` against the pooled
   count, and the holdout tool refuses to run if *any* family has a holdout row.
   *(Builder-check: my call; keeps §7 enforcement code unmodified.)*
2. Ingest: `BTCPERP` funding history + perp 1h klines into Postgres (new `funding` table;
   perp candles in `candles` under their own symbol).
3. `packages/core`: `carry.ts` (signal, position, funding accrual, rebalance, costs) +
   tests first.
4. `run-carry` CLI: dev backtest of the grid, writes an `evaluation` row, prints N.
5. `carry-verdict` CLI (holdout, once) — written and committed before step 6.
6. Holdout run → REPORT V2 section.
7. Only on PASS: `CarryLoopService` + dashboard card.

## 11. Left to the builder

- Table/column names, CLI flag shapes, dashboard layout.
- How perp candles are keyed (symbol string) as long as V1 queries are unaffected.
- Handling of missing funding prints (skip and log; never interpolate).

## Sources
- Bybit v5 API, queried 2026-11-10 (funding history, instruments-info).
- ESMA perps-as-CFDs: financemagnates.com/forex/regulation/esma-tells-firms-perpetual-futures-fall-under-eu-cfd-rules
- EU perp venues: coinperps.com/learn/best-crypto-futures-platforms-in-europe
