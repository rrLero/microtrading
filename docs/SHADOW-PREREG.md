# D4 shadow paper trading — pre-registration

**Written 2026-09-28, before the first shadow tick.** Human decision the same
day, logged as SPEC §7.5 **D4**. Immutable like `experiments/*.json`: changes are
dated amendments appended below, never edits above.

## 0. Why

On BTC alone the deployed strategy trades 10–25 times a year; §7.4's evidence
floor (100 raw trades, C2) is ~7 years away. The pooled walk-forward (#44) says
the same rule traded ~70×/yr across the ten-pair universe, and that its
aggregate result rests largely on one month (2024-11, REPORT §1.1). Forward
paper trading on the rest of the universe is the honest test of that result on
data no one has seen, at ~5× the rate. It is paper: no money, no demo orders.

## 1. What runs

- **Pairs:** the nine non-BTC pairs of `experiments/universe.json` (ETH, XRP,
  SOL, ADA, DOGE, ARB, SUI, MNT, AVAX), read from that file at runtime. BTC
  continues in its own account under the existing loop.
- **Rule:** exactly the deployed config — `STRATEGY_FAMILY` / `STRATEGY_PARAMS`
  (donchian-breakout 40/10, 4h derived from closed 1h) — through the same
  `TradingLoopService` code path. **No new configuration → no new trial; N stays 34.**
- **Sizing and risk:** §5 unchanged, per account. **10,000 USDC per pair,
  independent accounts** — no shared capital, so the §5.4 portfolio questions
  (aggregate exposure, correlation) do not arise; the price is that ten
  accounts are not a portfolio and no portfolio claim is made.
- **Costs:** §6.2 taker model, 0.10% fee + 0.03% slippage — the model the
  backtest used.
- **Isolation:** rows are `shadow-*`; no demo mirroring; ticks at :04; one
  pair's failure never stops another; the kill switch halts all accounts.
- **Start:** each account's first tick processes only the newest closed candle
  (no replay of history). Nothing before the first tick counts.

## 2. The verdict — evaluated once

- **Population:** the pooled round trips of all ten accounts (BTC + nine
  shadow) that **open** on or after the first shadow tick. BTC's earlier trades
  are excluded (they predate the design).
- **When:** at **100 pooled raw round trips**, or on **2028-03-28** (18 months)
  if 100 is not reached — then evaluated on what exists and reported as
  under-powered. Whichever comes first. Interim numbers may be looked at for
  operations and are shown on the dashboard; **nothing is stopped, re-tuned or
  re-selected because of them.**
- **Statistics reported:** pooled net return, profit factor, win rate, count;
  per-pair breakdown (a breakdown, never an alternative result — the universe
  file's rule); share of net P&L from the single best month (the §1.1
  concentration test); §7.4's kill criteria as written.
- **Cost sensitivity (pre-registered because the answer is already feared):**
  five of these pairs' p90 half-spreads exceed the 0.03% floor (§6.3 axis 2).
  The verdict is also reported re-costed at each pair's observed p90
  half-spread over the same period, from `ops/spread-sample`. If the two
  disagree on sign, the re-costed one is the headline.

## 3. What this cannot show

- Anything about live execution: paper fills, and the shadow pairs are not
  mirrored to demo.
- A portfolio result (§1).
- Anything about AI: the Phase 4 analyst watches BTC only and does not read
  shadow rows.

## 4. Exploratory pairs

Pairs outside the universe may later be added **only** as an appended
amendment, tagged `exploratory`, reported in a separate table, and **never**
pooled into §2's population. The universe was fixed by an ex-ante rule on
2026-08-12; choosing pairs now is the asset-mining that rule exists to stop.

## Amendments

*(none yet — append below with date and reason; never edit above)*
