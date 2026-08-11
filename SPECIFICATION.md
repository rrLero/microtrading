# MicroTrading — AI Trading Agent Specification

**Version:** 0.3 (all REVIEW.md questions R1–R12 resolved)
**Date:** 2026-08-02
**Author:** Roman Levchenko (with Claude)
**Status:** Ready for Phase 0 implementation
**Companion docs:** REVIEW.md (the adversarial review this version answers)

---

## 1. Purpose & Reader Context

This document specifies a "micro trading AI agent": an automated system that trades
small position sizes, using AI to inform trading decisions. It is written for an
experienced software engineer who is **new to trading**; concepts are explained
inline and a glossary is in Appendix A. Appendix B maps every review finding to
its resolution in this version.

### 1.1 Goals

1. Learn trading mechanics safely — **zero real money at risk in V1**.
2. Build an engineering foundation (data, strategy, execution, observability)
   that can graduate to small real-money trading only through predefined gates.
3. Evaluate where AI genuinely adds value vs. where deterministic code is better.

### 1.2 Non-goals (V1)

- Real-money trading.
- Scalping / high-frequency trading — ruled out by cost math (§2.3).
- Beating the market. The evidence is that >80% of active retail traders lose
  net of costs (Barber–Lee–Liu–Odean). V1 success = the infrastructure works,
  and the evaluation process is honest enough to tell us the truth (§7).

---

## 2. Resolved Decisions

### 2.1 Market & venue

- **Crypto spot.** 24/7 markets, native micro positions, free data.
- **Live target: Kraken** (MiCA-licensed, Ireland/CBI; ESMA register verified
  July 2026). **Paper venues:** local `PaperAdapter` (primary), **Bybit demo API**
  (`api-demo.bybit.com`, real market data + simulated account) for exchange-level
  integration in Phase 3. **Binance eliminated** (no MiCA license; EU lockout
  since 2026-07-01). Coinbase sandbox is static mocks — unusable.

### 2.2 Instrument: **BTC/USDC only in V1** *(changed in v0.3 — resolves R6, R11)*

- **One pair, not two.** BTC and ETH correlate 0.7–0.9; two positions of 1% risk
  behave like one ~2% position exactly when it hurts (correlations spike in
  stress). Rather than build correlation-aware risk bucketing in V1, we remove
  the problem: BTC only. ETH returns in V2 together with a correlation-bucketed
  risk model (§5.4).
- **Quote in USDC, not USDT and not EUR.** Reasoning chain:
  - USDT carries documented depeg/counterparty risk (stablecoin devaluation
    literature) — holding "cash" in USDT is a carry trade on Tether.
  - EUR quoting removes stablecoin risk but, under Polish tax law, **every
    crypto→fiat sale is a taxable event (19%, PIT-38)** while crypto→crypto
    trades are tax-neutral — EUR quoting would turn every exit into a tax event.
  - **USDC** is the intersection: tax-neutral trading (it's a crypto asset) and
    a MiCA-regulated e-money token with 1:1 reserve requirements. Kraken lists
    BTC/USDC with sufficient depth for micro size.
  - **P&L is *reported* in both USDC and EUR** (mark-to-market at current
    EUR/USDC) so a "flat" USDC result that is a real EUR loss is visible.
  - ⚠️ Tax treatment must be confirmed with a Polish tax advisor before any
    live trading. This spec's tax notes are engineering inputs, not advice.

### 2.3 Timeframe: 1h signals / 4h context — scalping is mathematically dead

Round-trip cost (2×fee + spread/slippage ≈ 0.26–0.32%) exceeds the average
per-candle move below the 1h timeframe (analysis retained from v0.2; table in
Appendix C). Positions are held hours-to-days targeting moves ≥1% (≥3× cost).

**Scope of this math (resolves R1):** the √-time scaling used here is valid only
for the *coarse feasibility* argument, where its error is in the safe direction
(crypto's fat tails make short timeframes worse, not better). It is **forbidden
as an input to risk sizing** — see §5.1, which uses current realized volatility.

### 2.4 Library & data

- **ccxt** v4.5.x (verified: MIT, WebSocket `pro` namespace included free).
- Historical data: ccxt `fetchOHLCV` backfill + Kraken bulk OHLCVT archives,
  **backfilled to 2019** to cover a full bull→bear→recovery cycle (resolves R8).
  Stored in SQLite, UTC timestamps only.

### 2.5 AI architecture: hybrid, LLM outside the order path

- Deterministic TS strategy engine makes every trade decision.
- LLM analyst (Anthropic API), daily + event-triggered (~$1–2/mo): regime
  commentary, news/sentiment features, post-trade reviews. Structured JSON out.
- **Hard rule 1:** the LLM never places orders.
- **Hard rule 2 (resolves R7 — look-ahead bias):** LLM features exist only from
  the moment they were generated live, timestamped, in the append-only journal.
  **It is forbidden to synthesize LLM features for past dates.** Backtests over
  periods before a feature existed run without it. Consequently, any strategy
  that *depends* on LLM features can only be evaluated forward, in paper, over
  calendar time (≥3 months) — this is budgeted in Phase 4/5. Every LLM-using
  strategy must also report an ablated (LLM-off) baseline.

---

## 3. Decision Flow & Timing Semantics *(resolves R12)*

```
Kraken public WS (1h/4h candles) ──► features ──► strategy ──► risk ──► execution
                                        ▲                        │
News/context (daily + events) ──► LLM analyst ──┘   (limits enforced here, always)
                                                                 ▼
                                          ExchangeAdapter: Paper │ BybitDemo │ Live
```

Timing rules — identical in backtest, paper, and live:

1. **Decisions fire only on closed candles.** A forming candle is never an input
   (acting on it is a look-ahead/repaint bug).
2. Signal computed at close of candle *t* → order placed at the **open of
   candle *t+1***. The backtester fills at *t+1*'s open, never *t*'s close.
3. The 4h context filter uses the **last fully closed 4h candle** as of the 1h
   decision time — never the 4h candle still in progress.
4. All internal timestamps are UTC epoch. Warsaw time is display-only.
5. **Restart reconciliation:** on startup the agent reads open orders/positions
   from the adapter *and* the journal; any mismatch → halt + alert, no trading
   until reconciled. Client-generated idempotent order IDs prevent double-trades.

---

## 4. System Components

All TypeScript (strict) / Node.js 22 LTS. **pnpm + Turborepo monorepo**:
`packages/core` (pure domain — types, indicators, strategy/risk/backtest
interfaces; zero framework imports, enforcing the one-code-path constraint),
`apps/agent` (**NestJS** service — DI for adapter swapping, `@nestjs/schedule`
for cadences; **Drizzle ORM + Postgres in Docker**, local-first: no hosted DB in
the trading hot path), `apps/dashboard` (**Next.js**, read-only, Phase 3;
optional Supabase read-replica sync for remote viewing). Components unchanged
from v0.2 except as noted: `market-data`, `features`, `strategy`, `risk`, `execution`
(`PaperAdapter` → `BybitDemoAdapter` → `LiveAdapter`), `llm-analyst`, `backtest`
(in-house, minimal — no mature TS alternative exists and the one-code-path
constraint forbids an external framework), `journal` (append-only; now also the
**experiment registry**, §7.1), `dashboard`.

### 4.1 Design constraints

1. **One code path** across backtest/paper/live; only the adapter differs.
2. **Deterministic core**; LLM output enters only as recorded features.
3. **Idempotent orders**; restart-safe (§3.5).
4. **Kill switch**: one flag/endpoint → cancel orders, flatten, halt. Tested
   as part of CI and drilled monthly during soak.
5. **Costs modeled on every simulated fill** (§6.2).

---

## 5. Risk Engine *(rewritten in v0.3 — resolves R1, R4, R11)*

### 5.1 Volatility-aware sizing (no constant-vol assumptions)

- **Stop distance** = 2 × ATR(14) on 1h candles (current realized volatility).
- **Position size** = (equity × 1%) / stop distance. Risk per trade ≤1% of equity.
- **Hard notional cap, independent of stop math:** position ≤ 10% of equity.
  This bounds gap risk: a 20% adverse gap through the stop costs ≤2% equity.
  (The cap exists because stops are intentions, not contracts — §5.2.)
- **Volatility circuit breaker:** if ATR% (ATR/price) exceeds its 95th
  percentile over the trailing year, no new entries. Vol clusters; the calm-day
  estimate is exactly wrong when it matters (GARCH literature).

### 5.2 Stop semantics — gaps are expected, not exceptional

- **Native exchange stop-market orders** (Kraken supports them), not
  agent-managed synthetic stops — protection persists if the agent dies.
  The agent reconciles native stops against the journal every cycle.
- Stop-market, not stop-limit: in a crash we accept bad fills over no fill.
- **Post-fill truth:** the risk engine recomputes equity/daily-loss state from
  the *actual* fill price the moment a stop executes. If the fill breaches the
  daily cutoff, trading halts immediately — the cutoff can be jumped over by
  one gap, which is why the notional cap (§5.1) exists as the real backstop.
- **Backtester stop model is pessimistic:** if candle low touches the stop,
  fill at min(stop price, next candle open) minus slippage — never at the stop
  price when the market gapped through it.

### 5.3 Account-level limits (V1, enforced as if real)

- Per-trade risk ≤1% · max 1 open position (BTC only) · notional ≤10% equity ·
  daily loss cutoff −3% (halt for the UTC day) · weekly cutoff −6% (halt, human
  review required to resume) · every position has a native stop before the
  entry order is considered complete.

### 5.4 V2 preview (not built now): multi-asset risk

ETH (and others) return only with correlation bucketing: assets with pairwise
correlation >0.6 share one risk bucket; bucket risk ≤1.5%, bucket notional ≤15%.

---

## 6. Execution & Fill Modeling *(resolves R9)*

### 6.1 Order types

Entries: limit-or-taker per strategy config. Exits: native stops (§5.2) +
strategy exits as taker. V1 default: taker entries (simplest honest model).

### 6.2 PaperAdapter fill model

- **Taker:** fill at next candle open ± slippage, slippage = max(half-spread,
  0.03%). Fees charged at Kraken taker tier.
- **Maker:** a resting limit fills only if the next candle's range **strictly
  crosses** the limit price (touch ≠ fill — queue position is unknowable), with
  configurable partial-fill fraction. Maker fills carry adverse-selection
  reality: you are filled precisely when the market moves against you; the
  backtest report must show maker strategies' results under taker-only mode too.
- **Pessimistic mode** (taker-only, worst-of slippage): **all go/no-go decisions
  are made on pessimistic-mode numbers.** Optimistic numbers are for debugging.

### 6.3 Calibration gate (Phase 3)

Run identical signals through PaperAdapter and Bybit demo (real matching engine)
for ≥2 weeks; if PaperAdapter's modeled costs deviate >30% relative from demo
fills, fix the model before trusting any paper result.

---

## 7. Evaluation Protocol *(new in v0.3 — resolves R2, R3; this section is the project's constitution)*

The evidence says the main enemy is our own evaluation process: ~10 strategy
configurations tried on noise yields an expected in-sample Sharpe of ~1.57
(Bailey–Borwein–López de Prado–Zhu, AMS 2014), and >80% of day traders lose
net of costs (Barber et al.). These rules exist to keep us honest, and they are
**frozen before Phase 1 code is written**.

### 7.1 Pre-registration & trial accounting

1. Before any backtest of a strategy family, its **full parameter grid is
   written to the journal and committed to git** (the pre-registration).
2. **Budget: ≤20 configurations per strategy family** (AMS guidance: ≤45 trials
   for 5 years of data; we stay well under with ~7 years).
3. Every backtest run is logged (params hash, git SHA, data range, results).
   **N (total trials) is printed on every report.** Reports without N are invalid.
4. The evaluation script refuses to run against the holdout unless the
   pre-registration exists and the trial budget is unexhausted — the discipline
   is enforced by tooling, because the researcher and developer are one person.

### 7.2 Data splits & walk-forward

- **Holdout: the most recent 12 months. Never opened during development.**
  One evaluation, at the end, per strategy family. A burned holdout cannot be
  un-burned; the calendar is the only way to grow a new one.
- Development window (2019 → holdout start) is evaluated by **walk-forward**:
  rolling 18-month train / 6-month test, stepping 6 months; only the
  concatenated out-of-sample segments count.
- **Regime reporting (resolves R8):** results reported per calendar year and per
  regime segment (trend state from 200-day MA slope + drawdown state). A
  long-only strategy must demonstrate it goes **flat in bear segments — being
  flat for months is success, not failure.**

### 7.3 Metrics (identical code in backtest and paper)

Net return, max drawdown, profit factor, Sharpe (annualized from 1h returns),
deflated Sharpe (using N from §7.1), win rate, avg win/avg loss, exposure %,
turnover, fee+slippage share of gross P&L.

### 7.4 Pre-committed decision rules

- **Minimum evidence:** no go/no-go judgment on fewer than **100 trades** of
  concatenated OOS + paper history. (A 2-week soak cannot qualify a strategy —
  it qualifies the *infrastructure*.)
- **Strategy kill criteria** (any one suffices): OOS/paper profit factor <1.1
  after costs over ≥100 trades · realized max DD >2× walk-forward max DD ·
  3 consecutive calendar months net negative.
- **Gate to live pilot** (all required): ≥3 months paper · positive net after
  costs in pessimistic mode · deflated Sharpe >0 at 95% confidence on the
  holdout · paper-vs-backtest tracking error within the §6.3 calibration bound ·
  kill switch drilled · custody rules of §9 in place · capital is money you are
  fully prepared to lose.
- **Project stopping rule:** if after two full strategy families evaluated
  honestly nothing passes, the correct output of this project is the
  infrastructure and the writeup — *that is a successful outcome.* The base
  rates say this is the most likely outcome; we commit to it in writing now.

---

## 8. Operations *(resolves R10)*

- **Runtime:** small EU VPS (or always-on home box), Docker, systemd/compose
  restart policy. The dev laptop is not an ops platform: the soak run's whole
  point is unattended operation.
- **Watchdogs:** candle-age monitor (alert if newest candle older than 2×
  timeframe), process heartbeat (push notification via ntfy/Telegram), crash-loop
  detector, position-age alert, daily P&L summary push.
- **Fail-closed policy, per failure class (documented, tested):**
  - Stale/no market data >15 min → cancel resting entry orders, halt new
    entries. (Live: native exchange stops remain active server-side — this is
    why §5.2 requires them.)
  - Reconcile mismatch on restart → halt + alert (§3.5).
  - Repeated order rejections → halt + alert.
- **Key management:** API keys in env files outside git, least privilege
  (**withdrawal permission never granted**), IP-allowlisted, rotated on any
  suspicion. Paper phase uses keyless public data wherever possible.

---

## 9. Custody & Live-Phase Prerequisites *(resolves R5 — out of V1 scope, binding later)*

- ≤30% of trading capital on-exchange; weekly sweep of excess/profits to
  self-custody or bank.
- Withdrawal-disabled, IP-allowlisted API keys (the agent is architecturally
  incapable of moving funds off-exchange); 2FA on the account; separate keys
  per machine.
- Exchange risk is unsecured-creditor risk (FTX precedent) — MiCA reduces,
  does not eliminate it. The sweep policy, not hope, is the mitigation.
- Confirm tax treatment (PIT-38; crypto→crypto neutrality; USDC classification)
  with a Polish tax advisor before the first live trade.

---

## 10. V1 Scope & Roadmap

**Definition of done (V1):** agent runs unattended ≥4 weeks paper-trading
BTC/USDC on 1h candles with full journaling, dashboard, watchdogs, and a
walk-forward + holdout report for both starter strategies over 2019→present,
produced under the §7 protocol.

Starter strategies (simple on purpose): 1) SMA crossover with 4h trend filter;
2) RSI mean reversion within uptrend. Pre-registered grids of ≤20 configs each.

| Phase | Deliverable | Est. effort |
|---|---|---|
| 0 | Scaffold; Kraken WS ingestion; SQLite store; backfill 2019→now; verify fee tiers, BTC/USDC depth, Bybit EU demo availability | 1–2 evenings |
| 1 | **§7 protocol tooling first** (pre-registration, trial log, walk-forward runner) → backtester + strategies + pessimistic fill model + reports | ~1.5 weeks part-time |
| 2 | Risk engine (§5) + PaperAdapter (§6.2) + journal; live paper loop | ~1 week part-time |
| 3 | Dashboard, watchdogs, kill-switch drill, BybitDemoAdapter + §6.3 calibration; ≥4-week unattended soak on VPS | ~1 week + soak |
| 4 | LLM analyst (live-only features per §2.5); ablation reporting | ~1 week part-time |
| 5 | Holdout evaluation (once) + §7.4 gate decision | — |

---

## Appendix A — Glossary
*(unchanged from v0.2: spot, OHLCV, long/short, limit/market, spread, slippage,
round-trip cost, stop-loss, drawdown, backtest, overfitting, look-ahead bias,
paper trading, maker/taker, signal, regime, MiCA — see v0.2 in git history; plus:)*

- **ATR (Average True Range):** rolling average of candle ranges — a live
  measure of current volatility; our unit for stop distances.
- **Walk-forward:** repeated train-on-past / test-on-next-slice evaluation;
  only the out-of-sample slices count.
- **Holdout:** data sealed away during development, evaluated exactly once.
- **Deflated Sharpe ratio:** Sharpe corrected for how many configurations were
  tried; a Sharpe that ignores N is marketing, not measurement.
- **Profit factor:** gross wins ÷ gross losses; <1.0 loses money before you
  even ask about risk.
- **Adverse selection (maker):** resting orders fill mostly when the market
  moves against them — why maker "savings" are partly illusory.
- **Fail-closed:** on uncertainty, reduce risk (halt/flatten) rather than
  continue.

## Appendix B — Review resolution map

| Review item | Resolution |
|---|---|
| R1 √-time misuse | §2.3 scope note; §5.1 ATR-based sizing; vol circuit breaker |
| R2 backtest protocol | §7.1–7.2: pre-registration, ≤20 trials, walk-forward, sealed 12-mo holdout, tooling-enforced |
| R3 stopping rule | §7.4: ≥100 trades, kill criteria, live gate, project stopping rule |
| R4 stop guarantees | §5.2: native stop-market, pessimistic stop fills, post-fill truth; §5.1 notional cap as gap backstop |
| R5 custody | §9: sweep policy, withdrawal-disabled keys, ≤30% on-exchange |
| R6 quote currency | §2.2: USDC (tax-neutral + MiCA e-money); dual USDC/EUR reporting; advisor confirmation required |
| R7 LLM look-ahead | §2.5 hard rule 2: live-only features, forward-only evaluation, ablation baseline |
| R8 regime coverage | §2.4 backfill to 2019; §7.2 per-regime reporting; flat-in-bear legitimized |
| R9 fill realism | §6.2 pessimistic mode governs decisions; maker crossing rule; §6.3 demo calibration gate |
| R10 24/7 ops | §8: VPS, watchdogs, fail-closed matrix, key hygiene |
| R11 correlation | §2.2: BTC-only V1; §5.4 correlation buckets before ETH returns |
| R12 timing/restart | §3: closed-candle rule, t+1 open fills, closed-4h context, UTC, restart reconciliation |

## Appendix C — Timeframe cost table *(from v0.2)*

| Timeframe | Avg move (2% daily vol, √t) | ÷ round-trip cost ~0.26% |
|---|---|---|
| 1m | 0.053% | 0.20× |
| 5m | 0.118% | 0.45× |
| 15m | 0.204% | 0.79× |
| 1h | 0.408% | 1.57× |
| 4h | 0.816% | 3.14× |
| 1d | 2.000% | 7.69× |

*(Feasibility argument only — forbidden for risk sizing, §2.3/§5.1.)*
