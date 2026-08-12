# MicroTrading V1 — Evaluation Report

**Status: DRAFT.** The holdout has not been evaluated. Sections marked
`[PENDING]` are structured but unfilled, deliberately: §7.2 permits the holdout
exactly one evaluation and it is scheduled for the end of the soak. Everything
else is final.

Written to the checklist in **Arnott, Harvey & Markowitz (2019), "A Backtesting
Protocol in the Era of Machine Learning"** (*Journal of Financial Data Science*),
whose seven categories are the section headings of §4–§10 below, plus the
four-item disclosure demanded by Bailey & López de Prado's *Deflated Sharpe
Ratio*.

---

## 1. Headline: the null, stated first

**No strategy configuration cleared the pre-committed evaluation gate.** Three
families, **34 distinct configurations**, evaluated at a verified cost basis
across a ten-pair universe.

The final family (`donchian-breakout`) clears the §7.4 kill line on development
data but fails two of the four conditions the project fixed in writing before
any result existed:

| §7.4 condition | Required | Observed (dev, pooled) | |
|---|---|---|---|
| Profit factor after costs | ≥ 1.1 | 1.45 – 2.37 (6/6 configs) | PASS |
| Minimum evidence | ≥ 100 trades | 215 raw / **59 effective** | **FAIL** |
| Deflated Sharpe | > 0 at 95% | **0.82** | **FAIL** |
| Holdout deflated Sharpe | > 0 at 95% | `[PENDING]` | — |

**This is the pre-registered success condition, not a disappointment.** §7.4,
frozen before Phase 1 code was written:

> **Project stopping rule:** if after two full strategy families evaluated
> honestly nothing passes, the correct output of this project is the
> infrastructure and the writeup — *that is a successful outcome.* The base
> rates say this is the most likely outcome; we commit to it in writing now.

---

## 2. Power: what this study could have detected

**The most important section of a null report, and the one most often missing.**
Without it, "we found nothing" is indistinguishable from "we could never have
found anything" (Harvey & Liu 2020, *False (and Missed) Discoveries*).

| | |
|---|---|
| Minimum detectable annualised Sharpe, 95%, N=34 | **1.04** |
| Best configuration's observed Sharpe | **0.85** |
| Verdict | Observed **below** the detection bar |

**What this null does and does not establish:**

- It **rules out** a persistent edge with annualised Sharpe materially above
  **~1.04** in this strategy family, on this universe, at these costs. Had one
  existed, this sample would have certified it.
- It **does not rule out** a genuine edge *smaller* than that. The observed 0.85
  is consistent both with a real but modest edge and with noise, and this data
  cannot separate the two.

So the honest claim is narrow: *donchian breakouts on liquid USDC majors do not
produce a large, easily-detectable edge net of realistic costs.* Anyone reading
this as "trend-following doesn't work" is over-reading it.

---

## 3. Disclosure (Bailey & López de Prado's four items)

> "…asks the strategist to disclose: i) the number of independent trials carried
> out (N); ii) the variance of the backtest results; iii) the sample length (T);
> and iv) the skewness and kurtosis of the returns."

| Item | Value |
|---|---|
| N — distinct configurations tried, all families | **34** |
| N — effective, after trial correlation | `[PENDING — see §11 limitations]` |
| T — pooled return observations | ~10 pairs × dev window, per config |
| Effective independent assets (Kish) | **2.2 – 2.9 of 10** |
| Return shape | skew/kurtosis feed the DSR directly (`metrics.ts`) |

---

## 4. Research motivation *(AHM category 1)*

**Economic foundation, fixed ex ante.** Donchian breakout is classical
trend-following: the hypothesis is that crypto majors exhibit momentum
persistence at multi-day horizons sufficient to overcome round-trip costs. The
family was chosen *because* it is slow — SPEC records it as "the structural
answer to the cost drag that killed both 1h families," a cost argument made
before it was tested.

**Pre-existence:** the grid was committed to git and journalled before any
backtest (§7.1). Pre-registration is immutable; tooling refuses to run against
the holdout without one.

---

## 5. Multiple testing *(AHM category 2)*

Every configuration tried, successful and unsuccessful:

| Family | Configs | Best PF | Best Sharpe | Max trades | Outcome |
|---|---|---|---|---|---|
| rsi-reversion | 16 | 0.54 | −0.57 | 451 | Killed |
| sma-crossover | 12 | 0.89 | −0.27 | 254 | Killed |
| donchian-breakout | 6 | 1.75¹ | 0.91¹ | 135 | Does not clear gate |
| **Total** | **34** | | | | |

¹ single-pair figures from the trial ledger; pooled universe figures in §1.

**The full inventory is the point, not an annex.** Two of three families lost
money outright. Reporting only donchian would be the file-drawer problem in
miniature, and would make its numbers unreadable — the deflated Sharpe is
computed against **N=34**, the real selection pool, precisely because donchian
was not chosen from its own six configs in isolation.

**Budget discipline:** ≤20 configs per family (§7.1), never exceeded.
MinBTL guidance (Bailey et al. 2014) suggests ≤45 independent configurations for
5 years of data; 34 sits under it.

---

## 6. Data and sample *(AHM category 3)*

| | |
|---|---|
| Data venue | Bybit (same as execution — removes a basis error, §7.5 D3) |
| Universe | 10 USDC spot pairs by ex-ante rule (§2.2) |
| History | ~28 pair-years, earliest 2021-12 |
| Timeframe | 1h ingested; 4h derived locally, closed candles only |
| Holdout | 12 months from 2025-08-01, **SEALED** |

**Integrity checks:** venue basis measured directly — Kraken vs Bybit over 2,160
matched Q1-2026 bars gave median 0.019%, p90 0.056%, max 0.201% difference, zero
bars beyond 0.30%. Data-source mixing is refused by tooling: the backfiller
purges rows whose source differs from the venue being ingested rather than
silently splicing two venues into one series.

**Selection rule was fixed before any backtest** and is decidable from exchange
listings alone: USDC-quoted, no stablecoin leg, ≥200k 24h volume, ≥3y history.
Pooled is the verdict; per-pair figures are a breakdown, never an alternative to
select among.

---

## 7. Cross-validation *(AHM category 4)*

- Walk-forward: rolling 18-month train / 6-month test, stepping 6 months; only
  concatenated out-of-sample segments count.
- Holdout sealed, one evaluation, tooling-enforced.
- **No iterated out-of-sample.** No configuration was modified after seeing an
  OOS result.
- **True out-of-sample is live trading only.** The paper soak is the only
  genuinely forward evidence and is reported separately (§10).

---

## 8. Costs, sensitivity, and capacity

The dominant finding of the entire project.

**The cost model was wrong.** `takerFeeRate` carried an unverified `0.0026` with
the comment *"Kraken entry tier — SPEC §7 open item: verify actual tier"* from
Phase 0 until 2026-08-12. Kraken's real Level 1 rate for BTC/USDC is **0.80%** —
3.08× the model. BTC/USDC takes the standard-crypto table, not the cheaper
stablecoin one, because a stablecoin that is only the *quote* currency does not
qualify.

**Sensitivity (BTC-only, {40,10}), and break-even:**

| taker | PF |
|---|---|
| 0.10% | 1.75 |
| 0.38% | 1.29 |
| 0.60% | 1.05 |
| **0.80%** | **0.88** |

**Break-even taker rate: ≈0.550%** for the §7.4 kill line, ≈0.657% for PF 1.0.
At Kraken's 0.80%, **0/6 configs survive**. At Bybit EU's 0.10%, 6/6 do.

**Venue dominates signal.** Kraken Level 1 is ~8× Bybit/Binance/OKX and ~600×
the observed half-spread. For retail-size systematic trading, venue selection is
a larger lever than strategy design, and it is checkable in an afternoon.

**Slippage model validated per pair.** §6.2 charges max(half-spread, 0.03%).
Sampled hourly on the execution venue: all 10 pairs under the floor, worst
ADA/USDC at 0.0270% — **90% of it**. Model is pessimistic, but not by much on
the thinner alts.

**Capacity:** not a binding constraint at this size. ~1,000 USDC per position
against multi-million daily volumes makes market impact negligible under the
square-root law; the cost model is essentially all fees.

**One real trade, as illustration.** The paper account took exactly one round
trip: bought 0.0154 BTC at 65,001.49 on a genuine breakout signal, sold at
65,085.62 during the kill-switch drill. Price moved *in its favour* (+1.29 gross);
fees took −5.20; net **−3.91**. A correct directional call that lost money to
costs.

---

## 9. Model dynamics, complexity, research culture *(AHM 5, 6, 7)*

- **Complexity:** two parameters. No machine learning, no feature selection, no
  black box. The curse of dimensionality is avoided by not inviting it.
- **Structural change:** the dev window spans the entire 2022 bear market; §7.2
  requires a long-only strategy to demonstrate it goes flat in bear segments, and
  being flat for months is recorded as success rather than failure.
- **No live-model tweaking:** the deployed configuration was never changed after
  seeing results. `{55,20}` is the best pooled config; `{40,10}` is what runs.
  Switching would have been post-hoc selection and is documented as declined.
- **Research culture:** researcher and developer are the same person, which is
  precisely why §7 is enforced by tooling rather than intention — the runner
  refuses an unregistered grid, refuses the holdout, and prints N on every report.

---

## 10. Infrastructure result

`[PENDING — soak completes 2026-09-04]`

§7.4 is explicit that a soak qualifies *infrastructure*, not a strategy. This is
where the project's actual deliverable is assessed: uptime, tick cadence,
catch-up replay, kill-switch drills, watchdogs, calibration coverage.

---

## 11. Protocol deviations *(the register)*

Three, all in `SPECIFICATION.md` §7.5 with the timing of when each was
recognised — the field separating a low-bias correction from a result-driven one
(Willroth & Atherton 2024).

| | What | Timing | Bias risk |
|---|---|---|---|
| **D1** | Taker fee 0.26% → 0.80% | Recognised from a published source, committed **before** any re-run | Low |
| **D2** | Execution venue Kraken → Bybit EU | **After** seeing failure at 0.80% | Contained by ex-ante venue rule + no-re-shop commitment |
| **D3** | Multi-pair universe; data venue → Bybit | **After** DSR stalled at 0.70 | Declared final amendment |

**Stated plainly: two of three deviations followed setbacks.** Each is
individually defensible; the sequence is what a project looks like when it is
talking itself into an answer. The sealed holdout is the remaining control.

**Known limitations:**
- Effective *trial* count is not computed. The 34 configurations are themselves
  correlated (same families, neighbouring parameters), so N=34 overstates the
  independent search. Correcting it would *raise* DSR, so it is left uncorrected
  as the conservative choice.
- Bayesianized p-values under multiple priors (Harvey 2017 §IX.A) are not
  computed.
- The soak has produced one strategy fill. Live evidence is negligible.

---

## 12. Conclusion

`[PENDING HOLDOUT]`

---

## Appendix A — Reproducing every number

```bash
pnpm --filter @microtrading/agent run-universe -- donchian-breakout
pnpm --filter @microtrading/agent cost-sensitivity -- donchian-breakout '{"entryLookback":40,"exitLookback":10}'
pnpm --filter @microtrading/agent calibrate-report
```

Trial ledger, pre-registrations and the full journal live in Postgres; grids and
the universe are in `experiments/`, git-tracked and immutable.

## Appendix B — Sources

- Arnott, Harvey & Markowitz (2019), *A Backtesting Protocol in the Era of Machine Learning*, JFDS — the checklist this report follows
- Harvey (2017), *Presidential Address: The Scientific Outlook in Financial Economics*, Journal of Finance
- Bailey, Borwein, López de Prado & Zhu (2014), *Pseudo-Mathematics and Financial Charlatanism*, Notices of the AMS 61(5)
- Bailey & López de Prado (2014), *The Deflated Sharpe Ratio*, JPM 40(5)
- Harvey & Liu (2015), *Backtesting*, JPM; Harvey & Liu (2020), *False (and Missed) Discoveries in Financial Economics*
- Frazzini, Israel & Moskowitz (2012), *Trading Costs of Asset Pricing Anomalies*
- Perold (1988), *The Implementation Shortfall: Paper vs. Reality*, JPM 14(3)
- Hasbrouck, *Securities Trading: Principles and Procedures*, Ch. 8
- Willroth & Atherton (2024), *Best Laid Plans*, AMPPS
- Kish (1965), *Survey Sampling* — design effect
- Cheverud (2001), Nyholt (2004), Li & Ji (2005) — effective number of independent tests
