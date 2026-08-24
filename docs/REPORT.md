# MicroTrading V1 — Evaluation Report

**Status: DRAFT pending the soak only.** Revised 2026-08-24 — §1.1 (concentration)
is new and decisive; §5 and §8 correct figures computed at a superseded cost
basis. The holdout has not been evaluated and,
on the reasoning in §1.2, **will not be** — it is recorded as sealed and
unopened, not deferred. The remaining `[PENDING]` is §10, which fills when the
soak completes 2026-09-04. Everything else is final.

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

Two families (`donchian-breakout`, `sma-crossover`) clear the §7.4 kill line on
aggregate development numbers. **Neither survives decomposition**: §1.1 shows
roughly four-fifths of each result is a single calendar month.

Read against §7.4's conditions as the spec actually words them:

| §7.4 condition | Required | donchian {55,20} | sma-crossover {10,200,30} |
|---|---|---|---|
| Profit factor after costs | ≥ 1.1 | 2.37 (6/6 configs) — PASS | 1.99 (11/12) — PASS |
| Minimum evidence | ≥ 100 trades, OOS + paper | 215 walk-forward OOS — PASS | 497 — PASS |
| 3 consecutive months net negative | must not occur | **occurs** (to 2024-06) | **occurs** (to 2024-08) |
| Holdout deflated Sharpe | > 0 at 95% | **not evaluated — sealed (§1.2)** | **sealed** |
| Regime: flat in bear (§7.2) | required, long-only | 10.3% bear exposure — PASS | 16.2% — PASS |

**Two corrections to earlier drafts of this table, recorded rather than quietly
fixed.** (i) §7.4's evidence floor is *"100 trades of concatenated OOS + paper
history"* — a raw count. Both families clear it and always did. Earlier drafts
recorded a **59-effective-trades** failure, applying a correlation deflation that
appears nowhere in the spec; it is a defensible statistic but was an unlogged
post-hoc tightening of a frozen protocol, which is the very thing §7.5 exists to
catch. It is reported in §3 as a *disclosure*, not as a gate. (ii) §7.4's
deflated-Sharpe condition is measured **on the holdout**, and belongs to the gate
to live pilot; the development DSR of 0.82 was never a gate and is not scored as
one here.

Neither correction changes the verdict. The verdict now rests on §1.1 instead,
which is stronger evidence than either withdrawn claim.

**This is the pre-registered success condition, not a disappointment.** §7.4,
frozen before Phase 1 code was written:

> **Project stopping rule:** if after two full strategy families evaluated
> honestly nothing passes, the correct output of this project is the
> infrastructure and the writeup — *that is a successful outcome.* The base
> rates say this is the most likely outcome; we commit to it in writing now.

Three families were evaluated, not two. The precondition is met and exceeded.

### 1.1 The result is one month

**The finding that decides this report.** Aggregate profit factor cannot
distinguish a persistent edge from one enormous month plus noise. Decomposed by
calendar month over the pooled ten-pair walk-forward out-of-sample window:

| | donchian {55,20} | sma-crossover {10,200,30} |
|---|---|---|
| Full period | +104.1% | +120.9% |
| **Excluding 2024-11** | **+24.2%** | **+25.0%** |
| 2024-11 alone | +64.4% | +76.8% |
| Share of result from that month | **77%** | **79%** |
| Negative months | 12 of 37 | 9 of 37 |

November 2024 — the post-US-election crypto rally — carries roughly four-fifths
of each family's entire three-year result. Strip it and the pooled ten-pair
strategy returns **~24–25% cumulative**: about 7%/year across the full 37-month
window, or ~11%/year measured only over the 25 months in which it traded at all
(the first twelve produce no trades — walk-forward warm-up). A quarter to a
third of all months are negative, and a third to a half of the months it actually
traded. All of it against a minimum detectable Sharpe of 1.04 that the sample
never reaches.

**The advertised profit factors of 2.37 and 1.99 are, to a first approximation,
descriptions of November 2024.** This is precisely the regime dependence REVIEW
R8 warned about before any code was written — *"a 2-year backtest is one regime,
long-only doubles down"* — and it was invisible in every aggregate metric the
project computed for six weeks. The deflated Sharpe was the only aggregate that
hinted at it (0.82 and 0.87, both short of 0.95), which is the argument for the
DSR in miniature.

It also disposes of the tempting response to a null: *"the edge is small but
real, just under-powered."* An edge that is 77% one month is not a small
persistent edge. It is one trade the market handed to every trend-follower alive.

### 1.2 Why the holdout stays sealed

§7.2 permits the holdout exactly one evaluation. This report spends it on
nothing, and the decision is recorded here rather than left implicit.

**The gate cannot be resolved by the holdout alone.** §7.4's gate to live pilot
is conjunctive — *all* conditions required. Three of them are not assessable for
months: ≥3 months paper (the account opened 2026-08-07, so 2026-11-07 at the
earliest), positive net after costs in pessimistic mode (currently −3.91 USDC on
a single round trip), and paper-vs-backtest tracking error within the §6.3 bound
(axis 4 of the calibration gate is NOT EVALUABLE — Bybit demo has zero spread,
so it cannot be closed on that venue at all). Two more conditions already fail on
development data: minimum evidence at 59 effective trades of 100, and deflated
Sharpe at 0.82 of 0.95.

So a favourable holdout would not produce a pass — it would produce a wait. An
unfavourable one ends the project, which is where the project already is. In
neither branch does opening it now change an action taken now.

**And the cost of opening it is asymmetric.** §7.5 records that two of three
deviations followed setbacks (D2 after failure at 0.80%, D3 after DSR stalled at
0.70). Both entries name the sealed holdout as the control that contains that
pattern — D2: "the only test not contaminated by that path"; D3: it "now carries
essentially all of this project's remaining credibility." Spending a one-shot
control months before its answer could be acted on, in order to learn something
that changes no decision, is the weakest possible use of it.

**Therefore: sealed, unopened, and reported as such.** It remains available to a
successor project that arrives with a genuinely new hypothesis rather than a
re-shopped one. A null result that honours its pre-registration is worth more
than a pass arrived at by widening — which is the same reasoning D3 used to
forbid a D4.

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
| N — effective, after trial correlation | **not computed, deliberately** — see §11 |
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

All three families, re-evaluated **2026-08-24** on the pooled ten-pair universe
at the current 0.10% basis. Earlier drafts of this table carried single-pair
figures computed at the retired 0.26%/Kraken basis, which understated two
families; those numbers are superseded:

| Family | Configs | Clear PF ≥1.1 | Best PF | Best Sharpe | Raw / effective trades | DSR | Outcome |
|---|---|---|---|---|---|---|---|
| rsi-reversion | 16 | **0/16** | 0.74 | −0.78 | 599 / 214 | 0.00 | **Killed** — well-powered negative |
| sma-crossover | 12 | 11/12 | 1.99 | 0.89 | 497 / 144 | 0.87 | Clears aggregate; fails §1.1 |
| donchian-breakout | 6 | 6/6 | 2.37 | 0.85 | 215 / 59 | 0.82 | Clears aggregate; fails §1.1 |
| **Total** | **34** | | | | | | |

**The full inventory is the point, not an annex.** `rsi-reversion` is a clean,
well-powered negative — 0 of 16 configurations clear the kill line, on 599 trades
and 214 effective, so this is a real rejection rather than an under-powered
shrug. Reporting only the survivors would be the file-drawer problem in
miniature, and would make their numbers unreadable — the deflated Sharpe is
computed against **N=34**, the real selection pool, precisely because no family
was chosen from its own configs in isolation.

**A process finding worth more than the result.** `sma-crossover` and
`rsi-reversion` were last evaluated 2026-08-06 and were never re-run after D1,
D2 and D3 changed the fee, the venue and the universe on 2026-08-12. For twelve
days the project's recorded state described two families by numbers computed at a
cost basis it had already repudiated — and `sma-crossover`, believed dead at
PF 0.89, in fact clears the kill line at PF 1.99 and carries 2.4× donchian's
effective evidence. A pre-registration protects against changing the question
after seeing the answer; it offers no protection at all against failing to re-ask
it after changing the costs.

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
- **Regime and calendar segmentation (§7.2, added 2026-08-24).** Results are
  broken out by regime segment (200-day MA slope × drawdown state, classified
  from price only — never from anything the strategy knows) and by calendar year
  and month, each with exposure, trades, net and PF. This is what surfaced §1.1;
  it was the missing piece that let an aggregate PF of 2.37 stand unexamined.
  `packages/core/src/regime.ts`, printed by `run-universe`.

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

**Slippage model NO LONGER validated — §6.3 axis 2 FAILS as of 2026-08-24.**
§6.2 charges max(half-spread, 0.03%). Hourly execution-venue sampling now stands
at n=2283: median 0.0137%, **p90 0.0324% — above the modelled floor** — max
0.1807%, with 278 samples (12.2%) in breach across seven of ten pairs. It passed
at every earlier reading (p90 0.0281% at n=1583 on 08-20); a liquidity regime
changed on 2026-08-21 and daily breach rates went ~5% to 22–35%. The sampler was
independently verified against a raw host-side REST read on 2026-08-24 (five
exact matches of ten, differences symmetric in direction), so the deterioration
is market structure, not instrumentation.

**It changes nothing, and that is itself the finding.** Re-pricing the whole grid
at the observed p90 moves donchian's best PF 2.37 → 2.37 and Sharpe 0.85 → 0.84;
break-even sits near **1.6% slippage, ~50× the modelled rate**. `fees/gross` is
0.03: these families trade rarely and hold long, so a per-trade cost constant
barely touches them. The failure is recorded as a failure rather than modelled
away — moving the constant until the gate passes is how the 0.26% fee error
survived Phase 0.

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
- **Structural change — now measured, not asserted.** §7.2 requires a long-only
  strategy to demonstrate it goes flat in bear segments. Both surviving families
  **pass**: donchian holds a position on 10.3% of bear pair-days (63 trades,
  +11.8%, PF 4.91), sma-crossover 16.2% (143 trades, +28.6%, PF 4.31). They do
  stand aside, and what little they trade there is profitable. This is a genuine
  positive result and it is not sufficient: standing aside correctly in bear
  markets establishes no edge when four-fifths of the profit is one bull month
  (§1.1).
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
- The soak has produced one strategy round trip (two fills). Live evidence is
  negligible.
- **The 0.03% slippage floor is now breached at p90 — §6.3 axis 2 FAILS.**
  Full numbers and the sensitivity that shows it immaterial are in §8. Left
  uncorrected deliberately: raising the modelled rate is a §6.2 cost-basis change
  against a frozen spec, for a correction worth 0.01 Sharpe, and amending a model
  to make a failing gate pass is the exact pattern §7.5 exists to prevent.
  Disclosed here because disclosure is cheap precisely when the verdict is
  already null — which is the point at which such things usually are not
  disclosed.
- **An unlogged protocol tightening was in force for weeks.** A 59-effective-
  trades bar, absent from §7.4, was recorded in project state as though it were
  the spec's requirement and blocked progress accordingly (§1). It was
  conservative in direction, which is why it went unchallenged — but a
  pre-registration is not protected only against changes that flatter. Corrected
  2026-08-24; noted here because the deviation register would otherwise show
  three deviations when the true count of unrecorded protocol drift is four.

---

## 12. Conclusion

`[PENDING — blocked on §10 only; soak completes 2026-09-04. Not blocked on the
holdout, which is sealed by decision per §1.2.]`

---

## Appendix A — Reproducing every number

```bash
# §1, §1.1, §5, §7, §9 — pooled evaluation, regime/year/month tables,
# concentration diagnostic and the §7.4 month-run scan, per family:
pnpm --filter @microtrading/agent run-universe -- donchian-breakout
pnpm --filter @microtrading/agent run-universe -- sma-crossover
pnpm --filter @microtrading/agent run-universe -- rsi-reversion

# §8 — slippage sensitivity: same grid, same window, one varied constant.
# Records nothing, so it consumes no trial budget (§7.1).
pnpm --filter @microtrading/agent run-universe -- donchian-breakout 0.000324
pnpm --filter @microtrading/agent cost-sensitivity -- donchian-breakout '{"entryLookback":40,"exitLookback":10}'

# §8, §11 — cost calibration by §6.3 axis
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
