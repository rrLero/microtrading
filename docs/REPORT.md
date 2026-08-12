# MicroTrading V1 — Evaluation Report

**Status: DRAFT.** The holdout has not been evaluated. Sections marked
`[PENDING HOLDOUT]` are written but unfilled, deliberately: §7.2 allows the
holdout exactly one evaluation, and it is scheduled for the end of the soak.
Everything else below is final.

| | |
|---|---|
| Period covered | 2026-08-07 → *(soak ends 2026-09-04)* |
| Strategy families evaluated | 3 of 3 (sma-crossover, rsi-reversion, donchian-breakout) |
| Distinct configurations tried | **34** |
| Evaluation universe | 10 USDC spot pairs, Bybit |
| Execution/data venue | Bybit EU (0.10% taker) |
| Holdout | **SEALED** — 12 months from 2025-08-01 |
| Protocol deviations | 3 (§7.5 D1–D3), all logged with timing |

---

## 1. What this project was for

An automated agent that trades small positions in BTC/USDC, paper-only in V1,
built to find out whether a simple systematic strategy survives realistic costs
— and, equally, to build an evaluation process honest enough that the answer
could be trusted either way.

§7 of the specification was written and frozen *before* Phase 1 code existed. It
opens by naming the enemy:

> The evidence says the main enemy is our own evaluation process: ~10 strategy
> configurations tried on noise yields an expected in-sample Sharpe of ~1.57
> (Bailey–Borwein–López de Prado–Zhu, AMS 2014), and >80% of day traders lose
> net of costs (Barber et al.).

And it pre-committed to the most likely outcome:

> **Project stopping rule:** if after two full strategy families evaluated
> honestly nothing passes, the correct output of this project is the
> infrastructure and the writeup — *that is a successful outcome.* The base
> rates say this is the most likely outcome; we commit to it in writing now.

That commitment is the reason this report exists in the form it does.

---

## 2. Headline result

*(Draft — to be finalised after the holdout evaluation.)*

Three strategy families were evaluated under the §7 protocol at a verified cost
basis. The final family, `donchian-breakout`, clears the §7.4 kill line on
development data pooled across a ten-pair universe, but **fails two of the four
statistical conditions the project set for itself before seeing any results**:

| §7.4 condition | Required | Observed (dev, pooled) | |
|---|---|---|---|
| Profit factor after costs | ≥ 1.1 | **1.45 – 2.37** (6/6 configs) | PASS |
| Minimum evidence | ≥ 100 trades | 215 raw / **59 effective** | **FAIL** |
| Deflated Sharpe | > 0 at 95% | **0.82** (N=34) | **FAIL** |
| Holdout deflated Sharpe | > 0 at 95% | `[PENDING HOLDOUT]` | — |

The gap is not marginal and it is not fixable by waiting: at the measured
correlation the universe produces roughly 21 effective trades a year, so closing
the evidence gap would take about two years.

---

## 3. What was built

Complete and operating unattended:

- `packages/core` — framework-free domain: indicators, strategies, the §6.2 fill
  model, walk-forward backtester, metrics including deflated Sharpe.
- `apps/agent` — NestJS: Bybit ingestion (1h, 4h derived locally), Postgres via
  Drizzle, risk engine (§5), `PaperBrokerService` (§6.2 pessimistic fills),
  hourly trading loop on closed candles, Bybit demo calibration mirror, hourly
  spread sampler, daily calibration probe, kill switch, read-only ops API.
- `apps/dashboard` — Next.js, read-only.
- §7 tooling — pre-registration, immutable grids, trial ledger keyed by cost
  basis, walk-forward runner, pooled universe runner, cost-sensitivity sweep,
  holdout guard.

The one-code-path constraint (§4.1.1) holds: the backtester replays the same
strategy, risk and fill code the live loop runs.

---

## 4. Method

`[TO EXPAND — awaiting reporting-standard research]`

- Pre-registration and trial accounting (§7.1)
- Walk-forward with sealed holdout (§7.2)
- Cost model and its verification (§6.2, §6.3)
- Pooled multi-asset evaluation and effective sample size (§2.2)

---

## 5. Findings

### 5.1 The cost model was wrong, and it decided everything

The taker fee carried an unverified `0.0026` with the comment *"Kraken entry
tier — SPEC §7 open item: verify actual tier"* from Phase 0 until 2026-08-12.
Verified against Kraken's published schedule, the real Level 1 rate for
BTC/USDC is **0.80%** — 3.08× the model, and BTC/USDC takes the standard-crypto
table rather than the cheaper stablecoin one because a stablecoin that is only
the *quote* currency does not qualify.

At the true rate, **no configuration of any family survives**: 0/6 donchian
configs cleared the kill line, and break-even sat at ≈0.55% taker.

This is the single most consequential finding in the project, and it had nothing
to do with strategy design. The fee schedule, not the entry rule, determined
every result:

| taker | PF (BTC only, {40,10}) |
|---|---|
| 0.10% | 1.75 |
| 0.38% | 1.29 |
| 0.60% | 1.05 |
| **0.80%** | **0.88** |

### 5.2 The venue, not the strategy, was the binding constraint

Kraken's Level 1 spot taker (0.80%) is roughly **8×** the entry-tier rate at
Bybit, Binance and OKX (0.10%), and about **600× the observed half-spread**. For
a strategy at this size, market impact is negligible and the entire cost model is
fees. Moving execution to Bybit EU — equally MiCA-authorised, so no regulatory
trade-off — changed 0/6 configs surviving into 6/6.

The lesson generalises: for retail-size systematic trading, **venue selection
dominates signal quality**, and it is checkable in an afternoon from published
fee schedules.

### 5.3 One real trade, and what it cost

The paper account took exactly one round trip:

| | |
|---|---|
| 2026-08-07 12:02 | BUY 0.0154 BTC @ 65,001.49 — *"4h close above 40-candle high 64951"* |
| 2026-08-09 21:38 | SELL @ 65,085.62 — kill-switch drill |

Price moved **in its favour** (+1.29 USDC gross). Fees took −5.20. Net **−3.91**.
A correct directional call that lost money to costs — the entire thesis of §5.1
and §5.2 in one trade.

### 5.4 Correlated assets do not multiply evidence

Widening to ten pairs raised raw trade counts ~7×, but crypto majors move
together. Measured on *strategy* returns (not asset returns — the strategy is
flat most of the time, so pairs are rarely in position together), mean pairwise
correlation is **0.27–0.39**, giving **2.2–2.9 effective independent assets of
ten** by the Kish design effect.

215 raw trades are therefore worth about **59 effective**. The evidence floor is
not met, and the configuration closest to meeting it (99 effective) is the
weakest performer.

### 5.5 What the evaluation protocol caught

Every one of these would have silently corrupted a result:

| Defect | Consequence had it survived |
|---|---|
| Taker fee 3.08× understated | Every backtest and the paper curve optimistic |
| §6.3 mirror read-back broken | Every demo fill journaled with null price/fee — calibration measuring nothing |
| Fill model copy-pasted in 4 places | A §6.2 change would leave the probe validating a retired formula |
| Calibration report pooled 3 cost bases | Aggregate deviation describing no model that exists |
| Trial ledger keyed by params only | Corrected re-run would skip every config and report retired numbers |
| DSR deflating against 6, not 34 | Selection bias priced at a sixth of its real size |

---

## 6. Protocol deviations

Three, all in `SPECIFICATION.md` §7.5 with the timing of when each was
recognised — the field that separates a low-bias correction from a result-driven
one (Willroth & Atherton 2024).

- **D1** — taker fee 0.26% → 0.80%. Recognised from a published source and
  committed **before** any re-run. Low-bias.
- **D2** — execution venue Kraken → Bybit EU. Decided **after** seeing the
  failure at 0.80%. Contained by an ex-ante venue rule, a no-re-shop commitment,
  and the sealed holdout.
- **D3** — multi-pair universe; data venue → Bybit. Also decided after a
  disappointing result. Declared the final amendment.

**The pattern is stated in the spec and repeated here:** two of three amendments
followed setbacks. Each is individually defensible; the sequence is what a
project looks like when it is talking itself into an answer. The sealed holdout
is the control that remains.

---

## 7. Holdout evaluation

`[PENDING HOLDOUT]` — one evaluation, at the end of the soak, on the frozen
specification. Result to be recorded here verbatim whatever it says.

---

## 8. Infrastructure result

`[PENDING SOAK COMPLETION 2026-09-04]`

Uptime, tick cadence, catch-up replay, kill-switch drills, watchdog behaviour.
§7.4 is explicit that a soak qualifies *infrastructure*, not a strategy — this
is the section where the project's actual deliverable is assessed.

---

## 9. Conclusion

`[PENDING HOLDOUT]`

---

## Appendix A — Reproducing every number here

```bash
pnpm --filter @microtrading/agent run-universe -- donchian-breakout    # pooled result
pnpm --filter @microtrading/agent cost-sensitivity -- donchian-breakout '{"entryLookback":40,"exitLookback":10}'
pnpm --filter @microtrading/agent calibrate-report                      # §6.3 by component
```

## Appendix B — Sources

- Bailey, Borwein, López de Prado & Zhu (2014), *Pseudo-Mathematics and Financial Charlatanism*, Notices of the AMS 61(5)
- Bailey & López de Prado (2014), *The Deflated Sharpe Ratio*
- Harvey & Liu (2015), *Backtesting*, Journal of Portfolio Management
- Perold (1988), *The Implementation Shortfall: Paper vs. Reality*, JPM 14(3)
- Hasbrouck, *Securities Trading: Principles and Procedures*, Ch. 8
- Frazzini, Israel & Moskowitz (2012), *Trading Costs of Asset Pricing Anomalies*
- Willroth & Atherton (2024), *Best Laid Plans*, AMPPS
- Kish (1965), *Survey Sampling* — design effect
- Cheverud (2001), Nyholt (2004), Li & Ji (2005) — effective number of independent tests
