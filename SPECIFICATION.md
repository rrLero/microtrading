# MicroTrading — AI Trading Agent Specification

**Version:** 0.3.1 (v0.3 frozen 2026-08-02; §7.5 deviation/clarification log and Appendix D errata appended 2026-08-25 — no frozen section was edited)
**Date:** 2026-08-02 (frozen text) · 2026-08-25 (last appended entry)
**Author:** Roman Levchenko (with Claude)
**Status:** Phase 3 soak ended 2026-09-06, C6 coverage NOT met (93.9%, §7.5 C9); D4 shadow paper trading from 2026-09-28; Phase 4 decided (`docs/PHASE4-PREREG.md`); holdout sealed by decision (REPORT §1.2)
**Companion docs:** REVIEW.md (the adversarial review this version answers) · docs/STRESS-TEST-2026-08-25.md (second review, against the ledger) · docs/REPORT.md
**Reading rule:** sections 1–10 are the frozen v0.3 text and contain stale statements. Appendix D lists every one with its current truth. §7.5 is the only section that grows.

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
- **Data venue: Bybit** *(changed 2026-08-12 — see §7.5 D3)*, i.e. the same
  venue we execute on. Two reasons, in order of weight:
  1. **Basis correctness.** Backtesting on Kraken's prints while filling on
     Bybit's book means the evaluated series is not the traded series. Same
     venue for both removes that error.
  2. **Reachability.** Kraken's OHLC endpoint returns ~720 bars regardless of
     `since`, so its deep history is only available as manually downloaded
     OHLCVT archives — unworkable for a multi-pair universe. Bybit serves years
     of 1h candles through the API.
  Cost, recorded honestly: BTC history shortens from 2020-01 to 2021-12. The
  window still contains the whole 2022 bear market, which is what §7.2's
  regime requirement actually needs.
- **Execution venue: Bybit EU** *(changed 2026-08-12 — see §7.5 D2)*. Bybit EU
  GmbH holds MiCAR CASP authorisation from Austria's FMA (28 May 2025, ESMA
  register), passporting to all 29 EEA states including Poland, and lists
  BTC/USDC. Spot fees are **0.10% maker / 0.10% taker** non-VIP.
  - **Why the venue moved:** Kraken's *standard-crypto* spot Level 1 is 0.80%
    taker (verified 2026-08-12) — 8× the retail rate at Bybit/OKX/Binance. Fees
    there run ~600× the observed half-spread, so venue fee schedule, not strategy
    quality, decides every result. No configuration of any family survives 0.80%.
  - **The selection rule is ex-ante and binding:** execute on the cheapest venue
    that (a) holds MiCA CASP authorisation valid in Poland, (b) lists BTC/USDC
    with adequate depth for micro size, and (c) exposes a drivable API with a
    demo endpoint. This rule is decidable from published fee schedules and the
    ESMA register **without running a single backtest**, which is what makes it a
    legitimate amendment rather than venue-shopping. Having chosen by the rule,
    we do not re-shop after seeing results. OKX Europe (MFSA, Jan 2025, 0.10%)
    is the equivalent alternative; Bybit wins only on already being integrated.
  - ⚠️ Bybit EU's BTC/USDC book (~$7.7M/24h) is thinner than global Bybit's.
    Immaterial at 10k notional, but it is the venue whose depth actually binds.
- **Paper venues:** local `PaperAdapter` (primary), **Bybit demo API**
  (`api-demo.bybit.com`, real market data + simulated account) for exchange-level
  integration in Phase 3. Modelled venue and mirror venue are now the same
  exchange, which is what makes the §6.3 comparison meaningful at all.
- **Binance eliminated** (no MiCA license; EU lockout since 2026-07-01).
  Coinbase sandbox is static mocks — unusable. **Kraken remains eliminated as an
  execution venue on cost**, not on regulatory grounds — its licensing is fine.

### 2.2 Instrument *(universe widened 2026-08-12 — see §7.5 D3)*

**Evaluation universe and trading universe are deliberately different things.**

- **Evaluation: a pre-registered multi-pair universe.** A strategy is judged on
  its performance *pooled* across every pair in the universe, with one parameter
  set applied uniformly. Rationale: the same two parameters working across ten
  assets cannot be curve-fit to any one of them, so cross-sectional consistency
  is stronger evidence than a single-asset result — independently of the fact
  that it also multiplies the trade count.
- **Universe selection rule (EX-ANTE, fixed before any backtest).** Every spot
  pair on the execution venue satisfying ALL of:
  1. quoted in USDC, and neither leg a stablecoin or FX token;
  2. ≥200,000 USDC 24h quote volume at selection time;
  3. ≥3 years of 1h history available from the data venue.

  The rule is decidable from exchange listings alone, with no backtest. **Pooled
  is the verdict; per-pair figures are a breakdown, never an alternative result
  to choose between.** Selecting the asset that happens to work is asset-mining,
  the same multiple-testing failure §7 exists to prevent.
- **Correlation is reported, not assumed away.** Crypto majors correlate 0.7–0.9,
  so pooled trades are far from independent. Every report prints **effective N
  alongside raw N**; a raw trade count across correlated assets overstates its
  own evidence exactly the way an undeflated Sharpe does.
- **Trading: still ONE open position at a time (§5.3).** The original BTC-only
  reasoning stands unchanged for live and paper trading: ten simultaneous long
  crypto positions at "1% risk each" is one ~8% risk when correlations spike.
  Concurrent multi-pair positions require the correlation bucketing of §5.4 and
  are out of V1 scope. Widening the universe widens what we *measure*, not what
  we hold.
- **Per-pair cost validation is a precondition.** The 0.03% slippage floor was
  validated against BTC's ~0.0001% half-spread. Thinner alts may exceed it,
  flipping the model from pessimistic to optimistic — the dangerous direction.
  No non-BTC result is trusted until `ops/spread-sample` covers that pair.
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
  0.03%). Fees charged at the **execution venue's** taker tier — Bybit EU
  non-VIP, 0.10% (§2.1). Half-spread evidence is sampled from the execution
  venue's book, not the data venue's (`ops/spread-sample`).
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

### 7.5 Deviation log

Deviations from pre-registration are recorded here, with the timing of when each
was recognised — the field that separates a low-bias correction from a
result-driven one (Willroth & Atherton 2024, *Best Laid Plans*). Amendments are
appended, never rewritten.

#### D1 — 2026-08-12 — taker fee corrected 0.26% → 0.80%

- **Original wording:** `DEFAULT_BT.costs.takerFeeRate = 0.0026`, annotated
  "Kraken entry tier — SPEC §7 open item: verify actual tier."
- **Deviation:** corrected to `0.008`, Kraken standard-crypto spot Level 1.
- **Reason:** the open item was closed by checking the source. Kraken's published
  schedule (kraken.com/features/fee-schedule, verified 2026-08-12) is 0.40%
  maker / 0.80% taker at Level 1. BTC/USDC takes the standard-crypto table, not
  the cheaper stablecoin/FX one: a stablecoin that is only the *quote* currency
  does not qualify (Kraken's own worked example is BTC/DAI). The modelled 0.26%
  was optimistic by 3.08x and matched no tier this account can reach.
- **Timing:** recognised from an external published source, and committed to the
  repository, BEFORE any re-run result was computed or seen. Low-bias category
  ("new knowledge gained", pre-results).
- **Tier choice is pre-committed, not selected:** go/no-go is decided at Level 1
  (0.80%) per §6.2 pessimistic-mode. A live account starts at zero 30-day volume,
  and this strategy's turnover (10-25 round trips/yr ≈ $17k-42k per 30 days at
  best, clustered rather than even) cannot hold a better tier through its own dry
  spells. Reported alongside is the **break-even taker rate**, so the verdict
  follows from a computed number rather than from a choice of assumption.
- **Trial accounting:** N is UNCHANGED. The grid, the families, the dev/holdout
  boundary and the walk-forward windows are untouched; one input constant was
  corrected uniformly across every config. No new configuration was introduced,
  so no new selection opportunity exists (Bailey et al., *Statistical Overfitting
  and Backtest Performance*: overfitting risk is driven by the number of variants
  from which the best is selected). `cost-sensitivity` logs no trials.
- **The 0.26% results are RETIRED, not retained.** They are superseded, and must
  not be presented as an alternative to the corrected numbers. Choosing between
  cost bases after seeing which flatters the strategy would manufacture exactly
  the selection bias this section exists to prevent.
- **Reader impact:** every pre-correction backtest and the paper equity curve to
  date understate costs. The paper account is materially unaffected (3.91 USDC
  spent over the whole soak — it has taken no strategy fills), so it was corrected
  in place rather than reset. Holdout remains SEALED and is not evaluated until a
  configuration survives at the corrected basis.

#### D2 — 2026-08-12 — execution venue moved Kraken → Bybit EU (0.80% → 0.10% taker)

- **Original wording (§2.1):** "Live target: Kraken (MiCA-licensed, Ireland/CBI)."
- **Deviation:** Kraken is retained as the *data* venue; **Bybit EU** becomes the
  execution venue, and §6.2 charges its 0.10% taker tier.
- **Reason:** D1 established that Kraken standard-crypto Level 1 charges 0.80%
  taker, ~8× Bybit/OKX/Binance and ~600× the observed half-spread. At that rate
  the fee schedule, not the strategy, determines every outcome: 0/6 donchian
  configs clear the §7.4 kill line, and break-even sits at ≈0.55%. The original
  venue choice was made on regulatory grounds (MiCA) in which Kraken and Bybit EU
  are equally qualified — Bybit EU GmbH holds Austrian FMA CASP authorisation of
  28 May 2025, ESMA-registered, passporting to Poland — so the cost difference
  was never traded against a licensing advantage. It was simply never checked.
- **Timing — READ THIS BEFORE TRUSTING ANY RESULT THAT FOLLOWS.** Unlike D1, this
  deviation was decided **after** seeing donchian fail at 0.80%. That ordering is
  exactly the risk profile the deviation log exists to make visible. Three things
  contain it, and none of them fully removes it:
  1. The venue rule in §2.1 is **ex-ante**: cheapest MiCA-authorised venue listing
     BTC/USDC with a drivable API. It is decidable from published fee schedules
     and the ESMA register with no backtest, and it selects Bybit EU (or OKX)
     regardless of how any strategy performs.
  2. It is **binding going forward**: having chosen by the rule, we do not
     re-shop venues if results disappoint. A third venue change requires a
     documented reason that is not "the last one failed".
  3. The **holdout stays sealed**. A strong dev-window result at 0.10% is
     permission to continue, NOT a verdict, precisely because we arrived at this
     venue via a failure. The holdout is the only test not contaminated by that
     path, and it is still worth exactly one evaluation.
- **Trial accounting:** N UNCHANGED. Same 6 configs, same families, same windows,
  same sealed holdout; one exogenous input constant changed uniformly. No new
  configuration was introduced, so no new selection opportunity over *strategies*
  exists. The selection opportunity that DOES exist is over *venues*, and §2.1's
  rule plus item 2 above is what constrains it.
- **The 0.80% results are retained as the Kraken-venue finding**, not retired:
  they are the evidence for why the venue moved, and they remain the correct
  answer to "does this work on Kraken?" — which is no.
- **Reader impact:** every result before 2026-08-12 is superseded. The paper
  account (10,000 USDC opened 2026-08-07) has taken no strategy fills and spent
  3.91 USDC, so it is corrected in place rather than reset; the soak clock for
  *strategy* evidence restarts at the corrected basis, while the Track A
  infrastructure soak continues uninterrupted from 2026-08-07.

#### D3 — 2026-08-12 — multi-pair evaluation universe; data venue Kraken → Bybit

**This is the FINAL amendment before the holdout is opened.** Recorded as a
commitment, not an aspiration: no D4. If the pooled result disappoints, the
answer is §7.4's project stopping rule, not another widening.

- **Original wording (§2.2):** "BTC/USDC only in V1 … One pair, not two."
- **Deviation:** evaluation runs pooled across a pre-registered universe of ≤10
  USDC spot pairs selected by the ex-ante rule in §2.2; the data venue moves
  from Kraken to Bybit. Trading remains one open position at a time.
- **Reason, in the order the reasons actually weigh:**
  1. **Cross-sectional robustness.** One parameter set holding across ten assets
     cannot be curve-fit to any one of them. This argument is independent of any
     result and would have been equally valid before Phase 1.
  2. **Evidence volume.** ~40 pair-years replaces 5.6, lifting raw OOS trades
     from 93 to an estimated several hundred — past §7.4's floor even after
     correlation shrinks the effective count hard.
  3. **Basis correctness.** Evaluating on Kraken prints while filling on Bybit's
     book meant the tested series was not the traded series.
  4. **Reachability.** Kraken's OHLC API caps at ~720 bars, so its deep history
     is manual quarterly archives (~25 downloads for 2020→now, verified against
     the Q1-2026 archive on 2026-08-12). Not workable for ten pairs.
- **Timing — the pattern matters more than this entry.** This is the third
  amendment in one day and the second decided *after* a disappointing result
  (D2 followed donchian failing at 0.80%; D3 follows DSR stalling at 0.70 on 93
  trades). Individually each is defensible; the *sequence* — repeatedly widening
  the search space following a setback — is what a project looks like when it is
  talking itself into an answer. Two things contain it:
  1. The universe rule is ex-ante and decidable from exchange listings with no
     backtest, and pooled-is-the-verdict forbids picking the asset that worked.
  2. The holdout is still sealed and now carries essentially all of this
     project's remaining credibility. It is worth exactly one evaluation, and it
     must not be opened until the spec has been frozen for a meaningful period.
- **Trial accounting:** N UNCHANGED at 6 configurations. Same grid, same
  parameters, same families; the cross-section widened and the price source
  changed. No new configuration was introduced. The new selection opportunity is
  over *assets*, and pooling is what closes it.
- **Cost, recorded:** BTC history shortens 2020-01 → 2021-12 (the 2020 crash and
  part of the 2021 bull run are lost; the 2022 bear market, which §7.2 actually
  requires, is retained). All Kraken-based results are superseded — including the
  0.10% figures from earlier today (PF 1.75, DSR 0.70, 93 trades), which were
  computed on a price series we no longer trade against.
- **Precondition before any non-BTC number is trusted:** `ops/spread-sample`
  must cover each pair (§2.2). The 0.03% slippage floor is verified conservative
  for BTC only.

#### D0 — 2026-08-06 (logged 2026-08-25) — third family registered after the §7.4 stopping rule fired

Backdated entry. Found by `docs/STRESS-TEST-2026-08-25.md` A1 against the
`experiments` ledger, nineteen days after the fact. D3's "no D4" commitment is
kept: this is not a new widening, it is the first one, which predates the log.

- **What the ledger shows (UTC):** sma-crossover pre-registered 22:54:56, its
  12 trials complete by ~22:56; rsi-reversion pre-registered 22:58:21, its 16
  trials complete by ~22:59; **donchian-breakout pre-registered 23:03:43** —
  after both prior families' results were on screen. §10 names SMA and RSI as
  the starter strategies; donchian is not in the frozen text at all.
- **The code and the grid say why.** `donchian-breakout.ts`: *"the structural
  answer to the cost drag that killed both 1h families."*
  `experiments/donchian-breakout.json`: *"per §7.4 the project stopping rule
  already triggered once."* §7.4 says: after two families evaluated honestly
  nothing passes → stop. A third was registered instead.
- **Timing:** decided AFTER seeing two families fail. Result-driven family
  choice, the same pattern D2 and D3 later record — and the first instance.
- **Trial accounting:** N=34 counts donchian's 6 configs alongside the 28 that
  preceded it, so the DSR already prices this selection. The *numbers* were
  never wrong; the *register* was incomplete and REPORT §1/§4 described the
  choice as ex-ante. Both are corrected in REPORT.
- **Note on §7.1.1:** "committed to git before any backtest" could not have
  held for any family — the repository was initialised 2026-08-11 14:16
  (`262eb78`); all three registrations carry `git_sha = 'no-git'`. The journal
  half of the rule held (11–15 s before each first trial). The git half was met
  retroactively on 08-11.

#### Clarifications — readings of frozen text that turned out not to be evaluable as written

A clarification does not change the question; it records how an ambiguous or
unevaluable sentence was read, and when. It is logged for the same reason a
deviation is: an unlogged reading in force for weeks is indistinguishable, to a
later reader, from a rule that was quietly tightened or loosened.

- **C1 — 2026-08-11 (logged 2026-08-25) — §6.3 read as four axes.** §6.3 asks
  for modelled costs within 30% of *demo fills*; Bybit demo fills at last price
  with zero spread and charges ~0.05%, so the sentence cannot be evaluated.
  `calibrate-report` reads it as four independent axes — fees vs published
  schedule, slippage vs sampled book, mechanics via demo, fill-model-vs-venue —
  and reports each. WORKLOG 08-11 flagged this as "a spec decision, not a code
  one"; the decision is recorded here. Axis 4 is structurally unclosable on a
  zero-spread demo and is reported NOT EVALUABLE, never PASS.
- **C2 — 2026-08-12 → withdrawn 2026-08-24 — §7.4 "100 trades" read as effective
  trades.** D3 added "every report prints effective N alongside raw N" to §2.2
  without saying which count gates §7.4. For twelve days project state treated
  59 effective as a failing floor. **Read as: raw trades gate; effective N is a
  disclosure (REPORT §3).** Bailey & López de Prado's DSR already absorbs
  sample-size and trial-count effects; a second deflation on top of it was a
  post-hoc tightening.
- **C3 — 2026-08-25 — §7.4 kill criteria, scoped.** (i) *"3 consecutive
  calendar months net negative"* is read on the pooled concatenated OOS + paper
  series (pooled is the verdict, §2.2), calendar months, a no-data or flat month
  breaks a run, and a fire inside the development window kills the family. Both
  surviving families fire (donchian to 2024-06, sma-crossover to 2024-08) and
  are therefore killed under §7.4, independently of REPORT §1.1's concentration
  finding — which remains the stronger evidence. (ii) *"realized max DD > 2×
  walk-forward max DD"* is read as paper-account drawdown since the account
  opened against the deployed config's pooled walk-forward OOS max DD.
- **C4 — 2026-08-25 — holdout boundary pinned; one evaluation total.** §7.2's
  "most recent 12 months" was implemented as *12 months before each family's
  registration*, so a family registered later would receive a later boundary
  whose development window overlaps every earlier family's sealed holdout.
  `HOLDOUT_FROM` is now the constant **2025-08-01 00:00 UTC** for every family,
  present and future. "One evaluation, at the end, per strategy family" is read
  as **one evaluation of the holdout, total** — three looks at the same twelve
  months are three evaluations. Data after 2026-08-01 is neither development
  nor holdout; it is the soak, and belongs to §10.
- **C5 — 2026-08-25 — total trial budget.** §7.1 caps configurations per family
  at 20 and never caps families, so N was unbounded; the stopping rule, the only
  other cap, was walked past once (D0). **N across all families ≤ 45** (MinBTL,
  Bailey et al. 2014, for ~5 years). Enforced in `preregister`. Registering a
  new family is a logged deviation.
- **C6 — 2026-08-25 — the soak's end.** §10 says "≥4 weeks unattended" and is
  silent on outages. Decided before the window closes so it cannot be chosen
  after seeing the last week: **the soak is 28 calendar days with ≥95% of hourly
  ticks observed; an outage extends the window by its own length.** Start
  2026-08-07 00:02Z, one outage of 47.4 h (08-18 21:07Z → 08-20 20:30Z), so the
  soak ends at the first tick after 2026-09-05 23:26Z — **2026-09-06 00:02Z**.
  Any "N days of soak" figure is net of the outage.
- **C7 — 2026-08-25 — §10 definition of done is not amended.** Its clauses
  ("1h candles", "both starter strategies", "holdout report") describe a system
  and a plan that D0–D3 and REPORT §1.2 have since changed. Amending §10 would
  be a D4. Instead REPORT §10 reconciles the definition of done clause by
  clause and states which are unmet and why.
- **C8 — 2026-08-25 — §7.1.3 "every backtest run is logged".** `run-universe`
  recorded nothing until 2026-08-25 (it "consumes no trial budget", which is
  correct, but logging and counting are different things). It now writes a
  `kind='evaluation'` row per run — params, git SHA, cost basis, sensitivity
  flag, universe, headline metrics — excluded from N. REPORT numbers computed
  before this date are reproducible from Appendix A but were not recorded when
  produced; the stress test says so.
- **C9 — 2026-09-25 — soak verdict under C6: NOT MET (93.9% < 95%).** Recorded
  19 days late; the rule is applied as written on 08-25, not re-read. Window
  2026-08-07 00:02Z → 2026-09-06 00:02Z = 720 hourly candles; the declared
  47 h outage removes 47 → 673 due. **632 ticks ran live** (88 more were
  replayed by catch-up, which decides the candle but cannot fill it live —
  see the 08-23 `mirror-skip-stale`, so they are not "observed"). Misses: host
  asleep 08-22 16Z→08-23 11Z (18) and 08-31 20Z→09-01 08Z (11), kill-switch
  drill 08-09/10 (9), short/DNS misses 08-07, 08-12, 08-24 (4). Excluding the
  drill as a deliberate halt gives 632/664 = 95.2% — a PASS — but C6 was written
  after the drill, named only one outage, and choosing the carve-out after
  seeing it flips the verdict is exactly what §7.5 exists to stop. Not adopted.
  Consequence: nothing downstream is gated on the soak except the start of
  Phase 4, which is observability-only and adds no trials, so it proceeds. What
  the soak did establish is §8's warning: the dev laptop sleeps, silently —
  the dead-man's ping (C-list, `HEALTHCHECK_PING_URL`) was never deployed.
- **D4 — 2026-09-28 — shadow paper trading on the nine non-BTC universe pairs.**
  Human decision. §5.3 pins V1 to "max 1 open position (BTC only)"; this sets
  that aside **for paper only**: each non-BTC universe pair gets its own
  independent 10,000 USDC paper account running the deployed config through
  the same loop code (no new configuration, **N unchanged at 34**), isolated as
  `shadow-*` journal rows, never mirrored to demo. Timing: recognised **after**
  the V1 null (REPORT §1) — the motive is statistical power (~70 vs 10–25
  trades/yr), not a result; the verdict rule, horizon and cost sensitivity are
  fixed in `docs/SHADOW-PREREG.md` before the first shadow tick. The traded
  pair, its loop and the Phase 4 window are unchanged.

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

## Appendix D — Errata *(added 2026-08-25; the frozen text above is not edited)*

Every statement in §§1–10 known to be stale, with its current truth. A reader
who hits a sentence in the frozen text that contradicts the codebase should
find it here; if it is not here, that is a new erratum to add.

| Where | Frozen text says | Current truth | Since |
|---|---|---|---|
| Header | "Ready for Phase 0 implementation" | Phase 3 soak; Phase 4 decided; holdout sealed by decision | 2026-08-07 / 08-16 / 08-25 |
| §2.1 | Kraken is the live target; "Kraken supports [native stops]" (§5.2); "Kraken lists BTC/USDC" (§2.2) | Bybit EU is both data and execution venue; Kraken is used for nothing | D2, D3 (2026-08-12) |
| §2.3, App. C | round-trip cost ≈0.26–0.32%, table divides by 0.26% | 2 × 0.10% + 2 × 0.03% = 0.26% by coincidence of the corrected numbers, but the components are different: fee 0.10% (was an unverified 0.26%), slippage floor 0.03% | D1, D2 |
| §2.4 | ccxt backfill + Kraken bulk OHLCVT archives; "backfilled to 2019"; "Stored in SQLite" | Bybit REST backfill; BTC history from 2021-12-09, ten-pair universe from 2021-12 to 2023-07; Postgres 16 in Docker via Drizzle | D3; Phase 0 |
| §2.5 | "news/sentiment features" | Dropped from Phase 4 scope — no licensed source, no consumer on a 10–25-trade/yr strategy; see `docs/PHASE4-PREREG.md` | 2026-08-25 |
| §3 diagram | "Kraken public WS (1h/4h candles)" | Bybit REST, hourly at :02, closed candles only; 4h derived locally | D3 |
| §3.5, §8 | restart reconciliation "documented, tested"; mismatch → halt + alert | Interface only. Paper state is DB-persisted (nothing to reconcile); the demo mirror is never reconciled. Untested. | — |
| §4.1.4 | kill switch "tested as part of CI" | No CI exists. Drilled manually 2026-08-09/10; next due ~09-09 | — |
| §5.2, §5.3 | native exchange stop before an entry is "complete" | No stop order is placed on demo; the paper stop is simulated per candle in the loop. Untested on any venue | — |
| §5.3 | weekly −6% cutoff, human review to resume | Not implemented; `RiskParams` has the daily cutoff only | — |
| §6.2 | maker fill model, partial fills | Not built; V1 is taker-only (the stated default) | — |
| §6.3 | ">30% relative from demo fills" | Not evaluable on a zero-spread demo; read as four axes | C1 |
| §7.2 | "Development window (2019 → holdout start)" | 2021-12 → 2025-08-01, pinned | D3, C4 |
| §7.2 | "one evaluation … per strategy family" | one evaluation, total | C4 |
| §8 | runtime: small EU VPS; "the dev laptop is not an ops platform" | Runs in Docker on the developer's Mac. One 47.4 h outage (laptop down) | — |
| §8 | watchdogs: candle-age ✓, heartbeat, crash-loop, position-age, daily P&L ✓ | Heartbeat is in-process (a dead host is silent — external ping added 2026-08-25, `HEALTHCHECK_PING_URL`); crash-loop = Docker restart policy, no alert; position-age not implemented | — |
| §2.2 (R6) | P&L reported in USDC **and EUR** | USDC only; EUR reporting not built | — |
| §10 | "1h candles"; starter strategies SMA + RSI; "holdout report for both" | Deployed strategy decides on 4h closes; a third family (donchian) was added (D0); holdout sealed by decision — DoD reconciled clause-by-clause in REPORT §10 | D0, C7 |
| §10 | "≥4 weeks unattended" | 28 days at ≥95% tick coverage, outages extend; ends 2026-09-06 00:02Z | C6 |
