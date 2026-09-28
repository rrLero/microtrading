# MicroTrading V1 — Evaluation Report

**Status: FINAL for V1 as of 2026-09-25** (§10 and §12 written after the soak). Revised 2026-08-25 after
`docs/STRESS-TEST-2026-08-25.md`: §1 and §4 no longer describe the third family
as an ex-ante choice (SPEC §7.5 D0); §1.2 no longer cites withdrawn gates; §10
carries the definition-of-done and built/not-built reconciliation; §11 counts
the register correctly. Revised 2026-08-24 — §1.1 (concentration) is new and
decisive; §5 and §8 correct figures computed at a superseded cost basis. The
holdout has not been evaluated and,
on the reasoning in §1.2, **will not be** — it is recorded as sealed and
unopened, not deferred.

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

The rule fired after two families on 2026-08-06 and was **overridden once**:
a third family was registered five minutes after the second one's results were
visible (SPEC §7.5 D0, found by the ledger nineteen days later). Earlier drafts
of this paragraph called that "met and exceeded"; it was an override, then the
rule was honoured. The deflated Sharpe's N=34 already prices the extra round of
selection, so the numbers stand; the description did not.

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

**Attribution of that month, by pair.** The natural objection — that a pooled
figure is hiding one runaway pair — does not hold, and the truth is more
interesting:

| | donchian | sma-crossover |
|---|---|---|
| Pairs contributing positively | 7 of 10 | 6 of 10 |
| Best month as share of whole period | 70% | 72% |
| **XRP + ADA as share of that month** | **71%** | **74%** |
| **XRP + ADA as share of the ENTIRE period** | **50%** | **53%** |
| …on this many trades | 2 | 3 |

*(Log shares — returns compound, so an arithmetic share of a large move
overstates it. The 77%/79% figures above are arithmetic; 70%/72% are the same
quantity measured correctly.)*

So it is genuinely **market-wide** — most of the universe rose and both families
caught it, which is what a beta event looks like. But within that month, **XRP
and ADA alone are roughly half of each family's entire three-year result, on two
or three trades.** And both families selected the same two pairs in the same
month, which is direct evidence that `donchian-breakout` and `sma-crossover` are
substantially the *same trade* in different parameters — the correlated-trials
problem the deflated Sharpe's N=34 exists to price, showing up in the open.

This disposes of the tempting response to a null: *"the edge is small but real,
just under-powered."* An edge that is half two positions in one month is not a
small persistent edge. It is one move the market handed to every trend-follower
alive, and the strategies' merit is that they were long for it — which is a
statement about November 2024, not about the strategies.

### 1.2 Why the holdout stays sealed

§7.2 permits the holdout exactly one evaluation. This report spends it on
nothing, and the decision is recorded here rather than left implicit.

**The gate cannot be resolved by the holdout alone.** §7.4's gate to live pilot
is conjunctive — *all* conditions required. Three of them are not assessable for
months: ≥3 months paper (the account opened 2026-08-07, so 2026-11-07 at the
earliest — 18 days in as of 2026-08-25, +1.5% on one completed round trip and
one open position), positive net after costs in pessimistic mode over that
whole period, and paper-vs-backtest tracking error within the §6.3 bound (axis
4 of the calibration gate is NOT EVALUABLE — Bybit demo has zero spread, so it
cannot be closed on that venue at all). *(An earlier draft of this paragraph
also cited "59 effective trades of 100" and "DSR 0.82 of 0.95" as failing
conditions; §1 withdraws both as gates, and they are withdrawn here too. The
argument does not need them.)*

And both surviving families are already **killed on the development window**:
§7.4's third kill criterion fires for each (§1 table; SPEC §7.5 C3), and §1.1
shows why the aggregate looked alive. A favourable holdout would therefore not
produce a pass — it would produce a wait on a family the protocol has already
stopped. An unfavourable one ends the project, which is where the project
already is. In neither branch does opening it now change an action taken now.

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
| donchian-breakout {55,20} observed Sharpe | **0.85** |
| sma-crossover {10,200,30} observed Sharpe | **0.89** |
| Verdict | Both observed **below** the detection bar |

**What this null does and does not establish:**

- It **rules out** a persistent edge with annualised Sharpe materially above
  **~1.04** in either surviving family, on this universe, at these costs. Had
  one existed, this sample would have certified it.
- It **does not rule out** a genuine edge *smaller* than that. The observed
  0.85 and 0.89 are consistent both with a real but modest edge and with noise,
  and this data cannot separate the two.

So the honest claim is narrow: *slow trend-following (Donchian breakouts, SMA
crossovers with a 4h trend filter) on liquid USDC majors does not produce a
large, easily-detectable edge net of realistic costs.* Anyone reading this as
"trend-following doesn't work" is over-reading it.

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

**Economic foundation — and an honest account of when it was chosen.** Donchian
breakout is classical trend-following: the hypothesis is that crypto majors
exhibit momentum persistence at multi-day horizons sufficient to overcome
round-trip costs. The family was chosen *because* it is slow — the code records
it as "the structural answer to the cost drag that killed both 1h families."
That sentence gives the timing away: **the family was selected after the first
two had failed**, five minutes after the second one's results were visible
(SPEC §7.5 D0). The economic argument is sound, but it was not made ex ante; an
earlier draft of this paragraph said it was. The deflated Sharpe's N=34 spans
all three families precisely so that this round of selection is priced.

**Pre-existence:** each grid was journalled 11–15 seconds before its first
trial (§7.1). Pre-registration is immutable; tooling refuses to run against the
holdout without one. The *git* half of §7.1.1 ("committed to git before any
backtest") could not have held — the repository was initialised 2026-08-11, five
days after registration; all three registrations carry `git_sha = 'no-git'`.

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
| History | ~40 pair-years of 1h candles in total (354k bars), earliest 2021-12; ~30 pair-years in the development window after the 12-month holdout is removed |
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

**The paper record, as illustration (through 2026-08-25).** Five fills. The
first round trip — bought 0.0154 BTC at 65,001.49 on a genuine breakout signal,
sold at 65,085.62 during the kill-switch drill — moved *in its favour* (+1.29
gross), paid −5.20 in fees, net **−3.91**: a correct directional call that lost
money to costs. The second, the only one closed by a strategy signal so far,
bought at 64,839.65 (08-18) and sold at 75,958.71 (08-23): +17.1% on price,
+1.7% on equity at §5.1 sizing — the position was ~10% of equity. Two more
entries (08-25, 09-03) were both stopped out. Equity at the soak's end
10,104.79 USDC (+1.05%; §10). None of this is evidence (§7.4: a soak qualifies
infrastructure); it is what the fill model looks like when it runs.

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

**Written 2026-09-25, nineteen days after the soak ended** (it ended
2026-09-06 00:02Z; no verdict was recorded until today — itself a finding).

**Verdict under SPEC §7.5 C6: NOT MET — 93.9% of due ticks ran live, against
95%** (C9). Window 08-07 00:02Z → 09-06 00:02Z = 720 hourly candles; the one
declared outage (47 h, 08-18 → 08-20) leaves 673 due; **632 ran live**. The other
88 candles were decided by catch-up replay after the process came back — six
replays, none lost a decision, but a replayed candle cannot be filled live
(the 08-23 exit was one), so they are not "observed".

| Miss | Ticks | Cause |
|---|---|---|
| 08-18 21Z → 08-20 21Z | 47 | declared outage (C6) |
| 08-22 16Z → 08-23 11Z | 18 | host asleep — one spread sample in 19 h, the whole VM paused |
| 08-31 20Z → 09-01 08Z | 11 | host asleep, unnoticed at the time |
| 08-09 21Z → 08-10 07Z | 9 | kill-switch drill (deliberate halt) |
| 08-07, 08-12, 08-24 | 4 | short misses; 08-24 a DNS failure |

Excluding the drill reads 632/664 = 95.2%, a pass. It is **not** adopted: C6
was written after the drill, named one outage, and choosing the reading that
flips a verdict after seeing it is the pattern §7.5 exists to stop.

What the soak did establish:
- **Correctness under interruption: yes.** Six catch-up replays (94 candles),
  closed-candle discipline held, every missed stop was evaluated against the
  candles it missed, zero `risk` rows, one `tick-error` in 30 days.
- **Kill switch: yes.** Drilled 08-09/10 (flatten, halt, resume) and a second
  on/off on 08-11 that correctly blocked a probe.
- **Unattended uptime on this host: no.** Both unexplained misses are the
  developer's Mac sleeping, and both were silent: the external dead-man's ping
  (`HEALTHCHECK_PING_URL`) was built on 08-25 and never deployed. §8 said the
  laptop is not an ops platform; the soak measured how much that costs.
- **§6.3 coverage:** 5,163 spread samples, 32 daily probes, every fresh strategy
  fill mirrored. Axis verdicts as of 2026-09-25: fees PASS; slippage FAIL at p90
  (0.0396% vs 0.030%, n=9,263; immaterial per §8); mechanics PASS (92 pairs,
  0 venue errors, 1 DNS error); fill-model-vs-venue FAIL at −128% on six
  strategy pairs — the *model over-charges*: demo fills landed ~2 min after the
  candle open the model prices at, and that drift was net favourable. Six
  pairs of timing noise is not evidence either way. Two reporting bugs were
  fixed before this was written (WORKLOG 2026-09-25): three of seven strategy
  mirrors had lost their price to a read-back race (two recovered), and
  slippage was measured as |drift|, which had booked favourable drift as cost
  and printed the opposite conclusion (+948% "under-charging").
- **Paper P&L over the window:** four round trips — the drill (−1.31), one
  signal exit (+170.30), two stop-outs (−32.78, −25.79); equity **10,104.79
  USDC (+1.05%)** at 09-06 00:02Z. Not evidence (§7.4).

§7.4 is explicit that a soak qualifies *infrastructure*, not a strategy. This is
where the project's actual deliverable is assessed: uptime, tick cadence,
catch-up replay, kill-switch drills, watchdogs, calibration coverage.

### 10.1 Definition of done (SPEC §10), clause by clause

SPEC §10 is frozen and describes a plan that D0–D3 and §1.2 have since changed
(SPEC §7.5 C7). Rather than amend it, each clause is scored here.

| §10 clause | Status | Note |
|---|---|---|
| agent runs unattended ≥4 weeks | **Unmet** | 93.9% live tick coverage vs C6's 95% (C9). Ran on the developer's Mac, not the VPS §8 specifies; two silent host sleeps (29 ticks) on top of the declared 47 h outage. Every missed candle was replayed; none was lost |
| paper-trading BTC/USDC | **Met** | one position, BTC/USDC only, since 2026-08-07 |
| on 1h candles | **Differs** | 1h ingested; the deployed strategy decides on closed 4h candles derived locally. The 1h families were killed on cost |
| full journaling | **Met** | append-only; over the window 5,223 ops rows, 720 decisions, 704 equity marks, 8 fills, every fresh fill mirrored |
| dashboard | **Met** | read-only, port 3002 |
| watchdogs | **Partial** | candle-age, loop-silence, infra-down, daily summary built; position-age and crash-loop alerts not; the heartbeat was in-process only until 08-25 (SPEC App. D) |
| walk-forward report for both starter strategies | **Met, and for a third** | SMA, RSI (the frozen starters) and donchian (D0), all pooled over the ten-pair universe |
| holdout report | **Unmet by decision** | §1.2. Sealed, not deferred |
| produced under the §7 protocol | **Met, with a register** | five deviations, nine clarifications (§11), all logged with timing |

### 10.2 Specified vs built

What §5 and §8 promise and what exists, so "the infrastructure works" is an
exact claim (SPEC Appendix D has the full list):

| Built and exercised | Specified, not built in V1 |
|---|---|
| §5.1 ATR sizing, 1% risk, 10% notional cap, vol circuit breaker | §5.3 weekly −6% cutoff |
| §5.3 daily −3% cutoff | §5.2 native exchange stops (paper stop is simulated per candle; none placed on demo) |
| §5.2 pessimistic stop fills, gap → next open | §3.5 restart reconciliation against a venue (interface only) |
| §6.2 taker fill model, single-sourced across backtest/paper/probe | §6.2 maker model |
| §4.1.4 kill switch: DB flag, flatten + halt, drilled 08-09/10 | §4.1.4 "tested in CI" — no CI |
| §8 candle-age, loop-silence, infra-down, daily summary pushes | §8 position-age alert, crash-loop alert |
| catch-up replay after outage, closed-candle discipline | §8 VPS runtime |
| §6.3 hourly ten-pair spread sampling, daily demo probe, per-axis report | §2.2 EUR reporting |

---

## 11. Protocol deviations *(the register)*

Five deviations and nine clarifications, all in `SPECIFICATION.md` §7.5 with
the timing of when each was recognised — the field separating a low-bias
correction from a result-driven one (Willroth & Atherton 2024).

| | What | Timing | Bias risk |
|---|---|---|---|
| **D0** | Third family registered after the §7.4 stopping rule fired (logged 08-25, nineteen days late, from the ledger) | **After** seeing two families fail | Priced by N=34; the register was incomplete and §1/§4 misdescribed it until 08-25 |
| **D1** | Taker fee 0.26% → 0.80% | Recognised from a published source, committed **before** any re-run | Low |
| **D2** | Execution venue Kraken → Bybit EU | **After** seeing failure at 0.80% | Contained by ex-ante venue rule + no-re-shop commitment |
| **D3** | Multi-pair universe; data venue → Bybit | **After** DSR stalled at 0.70 | Declared final amendment |
| **D4** | Shadow paper trading on the nine non-BTC universe pairs (2026-09-28) | **After** the V1 null; motive is power, not a result | Same config (N unchanged); verdict rule fixed in `docs/SHADOW-PREREG.md` before the first tick. D3 was declared final — this breaks that declaration, and says so |

Clarifications C1–C9 (§6.3 as four axes; raw-trade floor; kill-criteria scope;
pinned holdout and one evaluation total; total N ≤ 45; the soak's end rule; §10
not amended; evaluation rows; the soak verdict, C9) are readings of frozen text, not changes to the
question, and are logged for the same reason.

**Stated plainly: four of five deviations followed setbacks, and the first of
them went unlogged for nineteen days.** Each is individually defensible; the
sequence is what a project looks like when it is talking itself into an answer.
The sealed holdout is the remaining control.

**Known limitations:**
- Effective *trial* count is not computed. The 34 configurations are themselves
  correlated (same families, neighbouring parameters), so N=34 overstates the
  independent search. Correcting it would *raise* DSR, so it is left uncorrected
  as the conservative choice.
- Bayesianized p-values under multiple priors (Harvey 2017 §IX.A) are not
  computed.
- The soak produced four round trips (eight fills, one of them the drill).
  Live evidence is negligible.
- **The numbers in §1, §1.1, §5, §7 and §9 were produced by runs that were not
  recorded.** `run-universe` wrote nothing to the ledger until 2026-08-25
  (SPEC §7.5 C8); the only trial rows are at the retired and superseded cost
  bases. Everything is reproducible from Appendix A and the first recorded
  pooled evaluation rows (`experiments`, `kind='evaluation'`) reproduce the
  08-12/08-24 figures exactly — but for thirteen days the report's evidence
  existed only as prose.
- **The 0.03% slippage floor is now breached at p90 — §6.3 axis 2 FAILS.**
  Full numbers and the sensitivity that shows it immaterial are in §8. Left
  uncorrected deliberately: raising the modelled rate is a §6.2 cost-basis change
  against a frozen spec, for a correction worth 0.01 Sharpe, and amending a model
  to make a failing gate pass is the exact pattern §7.5 exists to prevent.
  Disclosed here because disclosure is cheap precisely when the verdict is
  already null — which is the point at which such things usually are not
  disclosed.
- **Two unlogged protocol readings were in force for weeks.** A 59-effective-
  trades bar, absent from §7.4, was recorded in project state as though it were
  the spec's requirement and blocked progress accordingly (§1; now C2). And
  §6.3's ">30% from demo fills" was read as four axes from 08-11 without the
  decision being recorded (now C1). Both were conservative in direction, which
  is why they went unchallenged — but a pre-registration is not protected only
  against changes that flatter. Together with D0, the register as it stood on
  2026-08-24 showed three deviations when the true count of unrecorded
  protocol drift was six.

---

## 12. Conclusion

*Written 2026-09-25.*

**The research question has a bounded null.** No strategy family shows an edge
that survives honest costs, pooled walk-forward and multiple-testing
deflation: RSI reversion fails outright; the two survivors (donchian, SMA
crossover) clear §7.4's kill line on aggregate only because of one month,
2024-11, which carries ~77–79% of their return, and both are net negative in
2025 (§1.1). The holdout stays sealed, by decision rather than deferral (§1.2):
there is no candidate worth spending it on.

**The infrastructure question has a qualified yes.** The system decides on
closed candles only, prices fills pessimistically, replays what it misses,
halts on command, and journals everything append-only — all exercised live
for thirty days. What it did not do is stay up unattended *on this host*:
93.9% live coverage against a pre-registered 95% (§10). The failure is the
host, and it is recorded as a failure, not reinterpreted.

**The process question is the most useful result.** Five deviations and nine
clarifications (§11), four deviations following setbacks, several readings
that ran unlogged for weeks, and — found while writing this section — a cost
report whose sign convention inverted its own conclusion. A pre-registered
protocol did not prevent any of that; the ledger made each one findable after
the fact. That is the honest scope of what the discipline buys.

Next, per `docs/PHASE4-PREREG.md`: the LLM analyst, observability only, N
unchanged at 34. Its forward clock started 2026-09-25 17:05Z; the window closes
2026-10-25 17:05Z (Amendment 3), after which §13 is written.

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
the universe are in `experiments/`, git-tracked and immutable. Since 2026-08-25
every `run-universe` invocation also writes a `kind='evaluation'` row (params,
git SHA, cost basis, sensitivity flag, universe, headline metrics) — cite the
row id when quoting a number:

```sql
select id, at, strategy_family, git_sha, payload->'best' from experiments
 where kind = 'evaluation' order by id;
```

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
