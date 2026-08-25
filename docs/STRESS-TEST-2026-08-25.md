# Stress test of SPECIFICATION.md v0.3, REPORT.md, WORKLOG.md, AGENTS.md

> **Applied 2026-08-25 (same day), under the human's delegation.** A1/A3/A4/A5
> → SPEC §7.5 D0 + C1–C8; A2 → `logEvaluation` + evaluation rows (#44 …);
> A6/A7 → `MAX_TOTAL_CONFIGS`, `HOLDOUT_FROM`; A8 → REPORT §10.1; B → REPORT
> §10.2 + SPEC Appendix D + `deadMansPing` (gated, not deployed); C → C6, soak
> ends 2026-09-06; D → REPORT §1, §1.2, §2, §4, §6, §8, §11; E → SPEC Appendix
> D, v0.3.1; F → `docs/PHASE4-PREREG.md`; G → AGENTS.md, (family, hash) key.
> WORKLOG 2026-08-25 (b) has the decision record. The text below is the review
> as written before anything was applied.

**Date:** 2026-08-25 · **Stance:** adversarial, same as REVIEW.md — but this
time every claim was checked against the trial ledger (`experiments` table),
the git log, and the code, not only against the prose.
**Verdict:** the protocol is stronger than almost any retail project's, and it
is precisely because it is strong that the gaps below matter — a reader who
trusts §7 will trust the numbers, and three of those numbers rest on things the
documents say happened but the ledger says did not.

Findings are ranked by how much they would cost the project's credibility if a
hostile reader found them first. Each has a proposed fix. **Nothing here
proposes touching the trading loop during the soak.**

---

## A. Protocol integrity — fix before REPORT §12 is written

### A1. An unlogged deviation: the third family was chosen after seeing the first two fail, and the stopping rule was walked past once

The ledger (`experiments`, UTC):

| family | pre-registered | first trial | result visible by |
|---|---|---|---|
| sma-crossover | 08-06 22:54:56 | 22:55:11 | ~22:56 |
| rsi-reversion | 08-06 22:58:21 | 22:58:32 | ~22:59 |
| **donchian-breakout** | **08-06 23:03:43** | 23:03:55 | — |

Donchian was registered **five minutes after the second family's results were
on screen.** The code says so itself (`donchian-breakout.ts:8`: *"the
structural answer to the cost drag that killed both 1h families"*), and so does
the grid file (`donchian-breakout.json`: *"per §7.4 the project stopping rule
already triggered once"*). §7.4 says: after two families, nothing passes →
stop. A third was run instead.

That is the same "widen after a setback" pattern D2 and D3 record — and it is
the first instance of it, three days before the log started. It is **not in
§7.5.** Worse, two sentences in REPORT contradict the ledger:

- §4: *"Economic foundation, fixed ex ante"* — the family was chosen ex post.
- §1: *"Three families were evaluated, not two. The precondition is met and
  exceeded"* — the rule said stop at two; running a third is an override, and
  "exceeded" reads as spin.

The N=34 deflation already prices this statistically, so the *numbers* are
fine. The *register* is incomplete and the narrative is wrong.

**Fix:** add **D0 — 2026-08-06 — third family registered after the §7.4
stopping rule fired** to §7.5, timing "after", bias contained by N=34. Rewrite
REPORT §1's sentence to *"the stopping rule fired after two families; it was
overridden once (D0), then honoured"*, and §4's to *"chosen after the 1h
families failed on cost — a result-driven family choice, deflated by N=34"*.

### A2. §7.1.3 is violated: every number in REPORT comes from an unlogged run

§7.1.3: *"Every backtest run is logged (params hash, git SHA, data range,
results)."* The ledger contains:

| rows | date | git_sha | what they are |
|---|---|---|---|
| 34 trials | 08-06 | `no-git` | Kraken, single pair, 0.26% — **retired** (D1) |
| 6 trials | 08-12 | `a2eb976` | Kraken, single pair, 0.10% — **superseded** (D3) |
| **0** | — | — | pooled 10-pair universe at the current basis |

`run-universe` deliberately records nothing ("no trial budget consumed"). But
*logging* a run and *counting it as a trial* are different things, and §7.1.3
asks for the first. PF 2.37 / 1.99 / 0.74, DSR 0.82 / 0.87, the regime tables,
the monthly concentration — all exist only as prose in WORKLOG and REPORT.
Appendix A says every number is reproducible from the CLI; nothing says it was
*recorded*.

**Fix (small, no loop impact):** `run-universe` writes one
`kind='evaluation'` row per family per run — params hash of the best config,
git SHA, universe, cost basis, slippage override, headline metrics. Excluded
from `countDistinctConfigsAllFamilies` by kind, so N is untouched. Then REPORT
can cite row ids.

### A3. "Committed to git before any backtest" is false for all three families

§7.1.1 and REPORT §4 say the grids were committed to git before any backtest.
The repository was initialised **2026-08-11 14:16** (`262eb78`); all three
registrations are dated 08-06 with `git_sha = 'no-git'`. The *journal*
pre-registration did happen 11–15 seconds before each first trial, which is the
substance of the rule — but the git half of the claim cannot be true.

**Fix:** REPORT §4 → *"journalled before any backtest; the repository did not
exist until 08-11, so the git half of §7.1.1 was met retroactively."*

### A4. §6.3 was reinterpreted by the tool and the reinterpretation was never logged

§6.3 as written: *"if PaperAdapter's modeled costs deviate >30% relative from
demo fills, fix the model."* Demo has zero spread and a 0.05% fee, so that
sentence is not evaluable. `calibrate-report` therefore reports **four axes**
instead. WORKLOG 2026-08-11 said explicitly: *"§6.3 text remains UNAMENDED …
if the human wants the gate itself to reflect this split, that is a spec
decision, not a code one."* No decision was ever recorded.

This is the same class as the 59-effective-trades drift that REPORT §11 already
admits — a tool-side reading of a frozen protocol, in force for weeks,
unlogged. §11 says the true count of unrecorded drift is four; it is five.

**Fix:** §7.5 gains a second list, **Clarifications** — readings of text that
turned out not to be evaluable as written, with timing — distinct from
**Deviations**, which change the question. Log the four-axis §6.3 there (08-11),
and the effective-N reading of §7.4 (08-12 → withdrawn 08-24).

### A5. Three §7.4 clauses are ambiguous, and two of them already cost real time

- **"100 trades"** — raw or effective? D3 introduced *"every report prints
  effective N alongside raw N"* into §2.2 without saying which one gates §7.4.
  That gap produced the 59-effective blocker.
- **"3 consecutive calendar months net negative"** — evaluated two ways on the
  same day (WORKLOG 08-24 b: "does not fire, account is 17 days old"; 08-24 d:
  "fires for both, on OOS months"). Window (paper? OOS?), aggregation (pooled?
  per pair?), and whether a dev-window fire kills a family are all undefined.
- **"realized max DD > 2× walk-forward max DD"** — realized *where*, over what
  window?

**Fix:** one sentence each, logged as clarifications with today's date. Proposed:
raw trades; kill criteria are read on pooled OOS + paper concatenated, and a
dev-window fire kills; realized = paper, since account open.

### A6. §7.1 caps configs per family but not families — N is unbounded

The stopping rule was the only cap on families and A1 shows it was bypassed
once. MinBTL guidance is ≤45 independent trials for 5 years; you have ~3.7
years per pair and are at 34.

**Fix:** *"Total N across all families ≤45. Registering a new family is a
logged deviation."* Cheap, and it makes Phase 4 prompt-hunting structurally
impossible.

### A7. The holdout boundary is computed, not pinned — and "one evaluation per family" is three evaluations

`experiment.service.ts:114`: `holdoutFrom = startOfUtcMonth(addUtcMonths(now, -12))`
**at registration time.** A family registered in September 2026 gets
2025-09-01, and its *development* window then includes 2025-08 — inside every
existing family's sealed holdout. And §7.2's "one evaluation, at the end, per
strategy family" is three looks at the same twelve months; each look tells the
researcher how that period behaved.

**Fix:** pin `holdoutFrom: 2025-08-01` as a constant in `universe.json` and in
§7.2; the code reads it, never computes it. §7.2 → *"one evaluation, total."*
Costs nothing now, protects Phase 4.

### A8. §10's definition of done cannot be met as written

§10 requires *"a walk-forward + holdout report for both starter strategies"*
and *"paper-trading BTC/USDC on 1h candles."* REPORT §1.2 seals the holdout by
decision; the deployed strategy trades 4h closes; the starter strategies named
are SMA + RSI, donchian is absent. Every V1 DoD clause is either unmet or
describes a different system.

**Fix:** either amend §10 (log it — it is a scope change, so a deviation), or
REPORT §12 states plainly which DoD clauses are unmet and why. Do not leave a
reader to discover it.

---

## B. Spec vs. what is actually built

None of these need building during the soak. All of them need to be **stated**
in REPORT §10, because §10 is the "infrastructure works" claim and a reader will
check it against §5/§8.

| Spec | Says | Reality |
|---|---|---|
| §5.3 | weekly −6% cutoff, human review to resume | **Not implemented.** `RiskParams` has daily only. |
| §8 | position-age alert | **Not implemented.** |
| §8 | crash-loop detector | Docker `unless-stopped` only; no alert. |
| §8 | process heartbeat push | **In-process only** — a dead host is silent. The 47h outage was found by a human, not by an alert. |
| §8 | runtime: VPS; *"the dev laptop is not an ops platform"* | Runs on the laptop. The 47h outage is §8's predicted failure. |
| §3.5 | restart reconciliation: mismatch → halt + alert, "documented, tested" | Interface only (`fetchOpenOrders`). Paper state is DB-persisted so nothing to reconcile; demo mirror is never reconciled. Untested on the path that matters. |
| §5.2 / §5.3 | native exchange stop before entry is "complete" | No stop order placed on demo; paper stop is simulated in-loop. Untested on any venue. |
| §2.2 (R6) | P&L reported in USDC **and EUR** | Not built anywhere. |
| §4.1.4 | kill switch "tested as part of CI" | No CI exists. 4 test files in the repo. |
| §6.2 | maker fill model, partial fills | Not built (V1 is taker-only by default — fine, but say so). |

**One of these is worth five lines now:** an external dead-man's switch. Have
the :02 tick ping a free healthchecks.io URL; it alerts when the ping *stops*.
It is the only thing on this list that the soak itself is supposed to be
proving, and it does not touch the decision path.

---

## C. The soak's own definition — decide it before 2026-09-04, not after

§10 says *"≥4 weeks unattended."* There was a 47h hole (08-18 21:07 → 08-20
20:30). The spec is silent on whether an outage resets or extends the clock.
WORKLOG 08-11 itself put the end at ~09-06; everything since says 09-04.
Deciding this *after* seeing whether the last week is boring is exactly the
timing problem §7.5 exists to catch.

**Fix, today:** *"soak = 28 calendar days with ≥95% of hourly ticks observed;
outages extend the window by their length."* That lands on ~09-06.

---

## D. REPORT.md contradicts itself and is stale

- **§1 vs §1.2.** §1 withdraws the 59-effective floor and the dev DSR as gates.
  §1.2, written 08-16, still uses both as reasons to keep the holdout sealed:
  *"Two more conditions already fail on development data: minimum evidence at
  59 effective trades of 100, and deflated Sharpe at 0.82 of 0.95."* §1.2 must
  stand on the concentration finding and the conjunctive-gate argument alone.
- **Stale figures:** §1.2 *"currently −3.91 USDC"* (equity is +153.97 after a
  completed 64,840 → 75,959 round trip); §8 *"One real trade"* and §11 *"one
  strategy round trip (two fills)"* (five fills, one signal round trip, one
  position open); §1.1 *"12 of 37"* negative months vs WORKLOG *"12/25"*; §6
  *"~28 pair-years"* vs D3 *"~40 pair-years"*.
- **§2 (power) covers donchian only** (0.85 vs 1.04) while §1 quotes
  sma-crossover's 0.89 as the best Sharpe. Power is per family; give both.
- **Status header** dates the revision 08-24 but §1.2's reasoning is 08-16.

---

## E. SPECIFICATION.md has stale text in frozen sections

Not one of these changes a decision, but together they make the spec read as if
nobody has looked at it since D3: status *"Ready for Phase 0"*; version 0.3
through three deviations; §2.4 SQLite, backfill to 2019, Kraken bulk archives;
§3 diagram *"Kraken public WS"*; §5.2 *"Kraken supports them"*; §2.2 *"Kraken
lists BTC/USDC"*; §2.3 and Appendix C at 0.26% round-trip; §7.2 *"2019 →
holdout start"*.

**Fix without breaking the freeze:** do not edit the sections. Add **Appendix D
— Errata**, one line per stale statement → current truth → date superseded →
which deviation. Bump to v0.3.1 and change the status line. The audit trail
survives and the document stops lying by omission.

---

## F. Phase 4 is decided but §2.5 is not specifiable yet

Now that the LLM analyst is scheduled (WORKLOG 2026-08-25), these are the holes
a Phase 4 pre-registration has to fill **before the first API call**, with the
same discipline as a grid:

1. *"event-triggered"* — which events? (fill, stop hit, daily cutoff, kill
   switch, candle-age alert?)
2. *"news/sentiment features"* — what source? None is named, none is licensed,
   and "news" on a 4h trend-follower with 10–25 trades a year has no obvious
   consumer.
3. Output schema — the JSON is unspecified. Pin it; a schema change is a new
   feature version.
4. **Prompt and model version recorded on every feature row.** A prompt edit is
   a new feature. Without this, prompt iteration is silent trial-hunting — the
   thing A6 forbids.
5. §7.4 has **no decision rule for LLM-using strategies** and §2.5's ablation
   baseline has no comparison statistic. Both must exist before any strategy
   ever reads a feature — even though V1 says none will.
6. Cost cap *"~$1–2/mo"* — enforced how? A runaway event trigger is a real
   failure mode.
7. Failure isolation identical to the mirror: every analyst error caught and
   journaled as `ops/analyst-error`; the loop never awaits it.
8. Kill switch → analyst pauses (it is a spend, and a halted account has
   nothing to review).

---

## G. Minor

- AGENTS.md says *"Position flat"*; a position has been open since 08-25 04:02.
- WORKLOG 08-24 (b) says the stopping rule *does not* fire; (d) says the
  3-month criterion fires for both. (d) supersedes (b) but neither says so.
- `experiments.params_hash` hashes params without the family name. No collision
  today (different key sets); a future family reusing `{fast, slow}` would
  silently merge into sma-crossover's N.
- §7.2 holdout is "the most recent 12 months" = 2025-08 → 2026-08. Data now
  runs to 2026-08-25; the soak sits in a window that is neither dev nor
  holdout. Harmless, but say which bucket post-holdout data belongs to.

---

## What to do with this, in order

1. **A1, A3, A4, A5** — register D0 and the clarifications in §7.5 (an hour;
   prose only). This is the part a hostile reader would find.
2. **D** — rewrite REPORT §1.2, refresh the stale figures (an hour).
3. **C** — define the soak end rule today.
4. **A7, A6** — pin `holdoutFrom`, cap total N (thirty minutes of code, no loop
   impact; needed before Phase 4).
5. **A2** — `evaluation` rows from `run-universe` (an evening; needed before
   REPORT is final).
6. **B** — the built/not-built table in REPORT §10 when the soak ends; the
   dead-man's ping now if you want the soak to prove what §8 claims.
7. **E** — Errata appendix, v0.3.1.
8. **F** — Phase 4 pre-registration document, before 09-04.

Nothing above changes the verdict. All of it changes whether the verdict can be
audited — which §7 says is the whole point.
