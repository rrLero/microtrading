# Work Log

Running history of operational and engineering work, for humans and AI agents.
Newest entries at the top. Keep entries short; link journal ids where useful.
(Entries before 2026-08-07 predate this log: Phases 0-2 were built per
SPECIFICATION.md — scaffold, ingestion/backfill 2019→now, §7 tooling,
backtester, three pre-registered strategy families evaluated, risk engine,
paper broker, trading loop, dashboard, watchdogs, ntfy alerts.)

## 2026-08-12 (late) — universe widened, power measured, report drafted

Continuation of the same day. Everything below is post-D2.

- **D3 (FINAL amendment):** evaluation widened to a pre-registered 10-pair USDC
  universe, and the DATA venue moved to Bybit as well. Kraken's OHLC API caps at
  ~720 bars (its deep history is manual quarterly archives — verified against the
  user's Q1-2026 download, which turned out to be one quarter, not full history),
  and evaluating on Kraken while filling on Bybit was injecting a basis error.
  Measured that error before switching: median 0.019%, p90 0.056%, max 0.201%
  over 2,160 matched Q1-2026 bars. Backfilled 354,080 1h candles across 10 pairs,
  up from 57,784. Kraken BTC candles backed up to `data-archive/` before purge.
- **Pooled result at 0.10%:** 6/6 configs clear the §7.4 kill line; best {55,20}
  PF 2.37 on 215 raw trades. Per-pair dispersion is large and coherent — the
  edge lives in the deep majors (BTC/XRP/SOL/ETH/ADA) and dies in the thin recent
  alts (ARB negative in all six configs).
- **Effective N, corrected twice.** First implementation correlated the ASSETS'
  daily returns (0.588) when what governs effective sample size is the
  correlation of STRATEGY returns — the strategy is flat most of the time, so
  pairs are rarely in position together. Measured properly it is 0.27-0.39,
  giving 2.2-2.9 effective assets of 10 by the Kish design effect. Researched
  Kish vs the spectral measure and settled it on the definitions: effective
  SAMPLE SIZE is about estimator precision (Kish); the spectral measure counts
  effective DIMENSIONS and belongs to the DSR's trial count, not here.
- **DSR now deflates against 34, not 6** — every distinct configuration tried
  across all three families. donchian was not selected from its own grid in
  isolation. Best config's DSR falls 0.96 → 0.82.
- **Power measured** (`minimumDetectableSharpe`, new in core): the minimum
  annualised Sharpe this sample could certify at 95% with N=34 is **1.04**; the
  best config's observed Sharpe is **0.85**. So the null is BOUNDED — it rules
  out edges materially above 1.04 and is silent about smaller ones. Per the
  reporting literature this is the single most important section of a null
  report, and it was missing until now.
- **Per-pair spread sampling** armed (one `fetchTickers` call, all 10 pairs
  hourly). All under the 0.03% floor; worst ADA/USDC at 0.0270% — 90% of it, and
  270x BTC's. Breaches flagged at write time as `exceedsModel`.
- **Dashboard:** folded spread sweeps into one feed row (per-pair sampling would
  otherwise have written 240 rows/day and buried the hourly decision), and added
  a meter for the widest spread as a share of the modelled floor.
- **`docs/REPORT.md` drafted**, structured to Arnott, Harvey & Markowitz (2019),
  the recognised backtesting protocol, with the full 34-config trial inventory
  including both families that lost money. Holdout, soak result and conclusion
  left as explicit [PENDING] placeholders.
- **Spec is now FROZEN.** No D4. Remaining work is the soak to 2026-09-04, the
  drill ~09-09, one holdout evaluation, and finishing the report.

## 2026-08-12 (evening) — execution venue → Bybit EU; 6/6 configs now clear

Follow-on from the 0.80% finding. The diagnosis was that this is a venue problem,
not a strategy problem: fees ran ~600x the observed half-spread, so Kraken's fee
schedule decided every result.

- **Regulatory check came first.** §2.1 eliminated Binance on MiCA licensing, not
  cost, so venue choice here is regulatory-first. Bybit EU GmbH holds Austrian
  FMA CASP authorisation (28 May 2025), is in the ESMA register, passports to
  Poland, lists BTC/USDC, and charges 0.10% maker/taker non-VIP. It clears the
  same bar Kraken was chosen for. OKX Europe (MFSA, Jan 2025, 0.10%) is the
  equivalent alternative; Bybit won on already being integrated.
- **§2.1 amended** (commit a2eb976): Kraken stays the DATA venue, Bybit EU
  becomes the EXECUTION venue. §6.2 charges 0.10%. The venue rule is written
  ex-ante and binding: cheapest MiCA-authorised venue listing BTC/USDC with a
  drivable API — decidable from published schedules and the ESMA register with no
  backtest, and binding against re-shopping if results later disappoint.
- **§7.5 D2 records the uncomfortable part:** unlike D1, this change was decided
  AFTER seeing donchian fail at 0.80%. The ex-ante rule, the no-re-shop
  commitment, and the sealed holdout contain that risk; none removes it.
- **Result at 0.10% — 6/6 configs clear the §7.4 kill line** (was 0/6 at 0.80%):

  | config | PF | trades | net% | maxDD% | Sharpe | DSR |
  |---|---|---|---|---|---|---|
  | **{40,10} deployed** | **1.75** | 93 | 10.4 | 3.4 | 0.91 | 0.70 |
  | {40,20} | 1.58 | 80 | 11.5 | 5.1 | 0.90 | 0.69 |
  | {55,10} | 1.58 | 83 | 7.2 | 3.3 | 0.69 | 0.53 |
  | {20,10} | 1.41 | 135 | 8.2 | 4.0 | 0.64 | 0.50 |
  | {55,20} | 1.39 | 72 | 8.7 | 4.2 | 0.74 | 0.57 |
  | {20,20} | 1.20 | 116 | 7.7 | 6.0 | 0.55 | 0.42 |

  Fees are now 8-9% of gross. **This is not a pass.** DSR tops out at 0.70 — a
  ~30% chance the best config's Sharpe is luck given the 6-trial budget — and
  §7.4's gate wants deflated Sharpe >0 at 95% confidence, on the holdout. Only
  {20,10} and {20,20} clear the 100-trade evidence floor, and they are the two
  weakest. The deployed {40,10} still has 93 trades.
- **Trial ledger fixed:** trials were keyed by params alone, so a corrected
  re-run would have skipped all six and reported retired numbers. `logTrial` now
  records the cost basis and `trialExists` matches on it. Pre-2026-08-12 rows
  carry no `costs` key and are superseded. N for §7.1 is still 6 configurations;
  12 trial ROWS now exist across two bases.
- **Deployed and verified:** container on `takerFeeRate: 0.001`, loop armed,
  flat, 9,996.09 USDC. Spread sampler repointed at Bybit — first live sample
  0.0001% half-spread vs 0.0300% modelled, so the floor still dominates.
- **Holdout still SEALED.** Nothing has earned it, and a dev-window pass reached
  via a venue change made after a failure is exactly the result that should not
  be trusted without it.

## 2026-08-12 (afternoon) — the taker fee was wrong by 3x; no config survives

Chased the `// SPEC §7 open item: verify actual tier` comment that had been
sitting on the cost model since Phase 0. Verifying it ended the strategy search.

- **The fee** (commit 373337a): Kraken standard-crypto spot Level 1 is **0.80%
  taker** (0.40% maker), verified against kraken.com/features/fee-schedule.
  BTC/USDC takes that table, NOT the cheaper stablecoin/FX one — a stablecoin
  that is only the *quote* currency does not qualify (Kraken's own worked example
  is BTC/DAI). The model carried 0.26%: optimistic by 3.08x, matching no tier
  this account can reach. `btFor()` feeds both the backtester and the live loop,
  so every backtest and the paper curve understated costs.
- **Protocol first, number second.** The correction was committed, and the §7.5
  deviation log written, BEFORE any re-run was executed — so the cost basis
  cannot have been chosen to flatter the result. Tier for go/no-go pre-committed
  to Level 1 per §6.2 pessimistic-mode. N unchanged (same 6 configs, same windows,
  same sealed holdout; one input constant corrected uniformly).
- **`cost-sensitivity` CLI** (new, read-only, logs no trials): sweeps takerFeeRate
  over the unchanged pre-registered grid and reports the break-even rate, so the
  verdict follows from a computed number instead of a choice of assumption.
- **Result — 0/6 configs clear the §7.4 kill line at 0.80%:**

  | config | PF | trades | net% |
  |---|---|---|---|
  | {20,10} | 0.69 | 135 | -10.5 |
  | {20,20} | 0.63 | 116 | -8.6 |
  | **{40,10} deployed** | **0.88** | **93** | **-3.2** |
  | {40,20} | 0.83 | 80 | -0.5 |
  | {55,10} | 0.80 | 83 | -4.7 |
  | {55,20} | 0.73 | 72 | -1.9 |

  Deployed config break-even: PF crosses the 1.1 kill line at ≈0.550% taker and
  1.00 at ≈0.657%. At the retired 0.26% it showed PF 1.47 / +7.1% — the entire
  apparent edge was the fee error. Two configs exceed the §7.4 100-trade evidence
  floor (135, 116) and fail decisively; the deployed one has 93, seven short, so
  a formal kill of that specific config is not yet licensed by the rule.
- **Holdout NOT evaluated.** §7.2 burns it once and nothing has earned it.
- **Redeployed** so the live paper loop runs the corrected 0.80%; verified in
  container (`takerFeeRate: 0.008`), tick at 07:02 UTC clean, still flat.
- **Spread-vs-volatility, preliminary** (n=20, joins ops/spread-sample to the 1h
  candle's high-low range): volatile half averages 0.0028% half-spread vs 0.0011%
  calm — real but tiny, and the worst sample anywhere is 0.0074%, still 4x under
  the 0.03% modelled floor. Correlation is only 0.084 and this window contains no
  actual stress event (mean hourly range 0.33%), so it is directionally
  reassuring and statistically thin. The method exists now; it needs weeks and a
  volatile stretch to mean anything.
- **Open decision (human):** §7.4's project stopping rule says the correct output
  is the infrastructure plus the writeup, and donchian was the third and final
  family. The counter-argument is that the strategy clears the kill line at any
  rate ≤0.55% and average turnover might sustain Level 3-4. Reopening the tier
  *after* seeing 0.55% is the selection bias §7.5 exists to prevent — recorded
  here so the choice is made in daylight either way.

## 2026-08-12 — one fill model, four call sites (§6.2 single-sourced)

Day-5 soak check clean: 57 decision+equity pairs over 48h, no risk/error
entries, flat, both crons firing unattended (19 spread samples, probe at 13:37).
Price is 2.50% below the 40-bar trigger (65,400, set 08-09 20:00 UTC and pinned
there for ~a week by the 65.3k cluster behind it), so no strategy fill is near.

- **Refactor** (`packages/core/src/fill-model.ts`, commit f48e5e0): the §6.2
  taker formula was copy-pasted in four places — backtest engine entry + exit,
  PaperBrokerService buy + sell, and the calibration probe's paper side. All
  four agreed numerically, so nothing looked wrong. The probe's copy is the
  dangerous one: §6.3 compares the paper model to the venue, so a §6.2 change in
  PaperBrokerService would have left the probe validating the retired formula
  and the report silently measuring nothing. Now one `modelFill()` in core, all
  four routed through it. Pre-existing backtest tests pass unmodified (the
  point); new `test/fill-model.test.ts` pins the arithmetic. Verified live —
  probe #290 through the new path reports the same modeled 0.3000+2.6008 as its
  pre-refactor twins at the same size.
- **§6.2 gap, latent, not fixed**: the spec says slippage = max(half-spread,
  0.03%); the implementation uses the flat 0.03% and never reads a book. Every
  Kraken sample so far is far under the floor (median 0.0012%, max 0.0074%,
  0/20 exceedances), so the flat rate is currently the stricter of the two — but
  in a spread blowout the model would under-charge exactly when it matters. The
  sampler now collects what is needed to close this; `fill-model.ts` names the
  upgrade path.
- **Open decision for the human** (§6.3 interpretation, not an agent call):
  (a) the spec says "identical signals", not "identical *strategy* signals" — if
  probe pairs count, the gate becomes evaluable ~08-25, inside day 28; waiting
  on strategy fills likely does not, since the first fill must land by ~08-21 and
  would yield n≈2. (b) total deviation is −82.8% and will never pass, dominated
  by the −80.8% fee gap between Bybit demo's tier and the hardcoded Kraken tier
  — a category difference, not a model error. The gate needs to be stated over
  slippage + mechanics, with fees checked against Kraken's published tier.

## 2026-08-11 — §6.3 mirror was recording nothing usable (BUG) + daily probe

Day-4 soak check was clean (24/24 ticks, no risk/error entries, flat since the
drill). Chased the one thing not progressing — zero calibration pairs — and the
probe work uncovered a silent mirror bug.

- **BUG, pre-existing, now fixed** (`bybit-demo-mirror.service.ts`): the fill
  read-back used `fetchOrder`, which ccxt's bybit throws `ArgumentsRequired` on
  unless `params.acknowledged` is set. The `catch { break }` swallowed it and
  kept the create-response, whose `average` is null for a market order — so
  EVERY demo-fill was journaled with `demoAvgPrice: null`, `demoFeeUsdc: null`
  and would have been silently excluded from calibrate-report. The mirror has
  been "armed" since 08-10 while capable of capturing nothing. Now reads
  `fetchMyTrades({orderId})` (authoritative price + fee, correct fee currency)
  and records `readbackTrades: N` so a future miss is visible.
- **Venue lag, measured**: Bybit demo publishes a filled spot order to the
  execution list 4.3-9.1s after the order response. Read-back budget set to 25s
  (`READBACK_MS`), returns as soon as trades appear. A 1.5s window yields nulls.
- **Daily calibration probe** (`calibration-probe.service.ts`, cron 13:37 UTC,
  `ENABLE_CALIBRATION_PROBE` in docker-compose.local.yml): one ~1000 USDC
  buy→sell round trip on the demo book, paired against what §6.2's model would
  have charged at the same instant. 2 pairs/day vs ~2/month from the strategy.
  Never touches paper_account; skips when the kill switch is on (drilled — see
  journal, probe correctly refused). On-demand run: `pnpm calibration-probe`.
- **calibrate-report rewritten** to stop lying in two ways: probe pairs are a
  separate population from strategy fills (§6.3 wants identical *signals*, and a
  probe is not a signal — the gate verdict uses strategy fills only), and
  slippage is broken out from fee.
- **Open question raised by the first real pairs** (probe #213): demo slippage
  measured 0.0000 on every leg — the demo fill price equalled the pre-order
  ticker last exactly, 3/3 probes. And modeled fee (Kraken 0.26%) vs demo fee
  (Bybit 0.05%) is a venue-tier difference, not a model error. So as built, the
  §6.3 comparison may be unable to validate slippage at all. → ANSWERED below.

## 2026-08-11 (later) — Version control, and where slippage is actually measurable

- **`git init`** — the project had NO version control through all of Phases 0-3
  and 4 days of soak. Baseline commit made; `.gitignore` hardened (`.env.*`,
  `!.env.example`, `.next/`, `.DS_Store`) and verified that only `.env.example`
  is tracked. Revertability starts at commit 262eb78.
  (Unverified: whether `.env.example` itself is a clean template — inspecting it
  was declined, so treat it as unaudited until a human eyeballs it.)
- **Bybit demo cannot calibrate slippage — settled.** Probe #222 repeated the
  round trip at 10× size (10,000 USDC / 0.155 BTC): fill price was again EXACTLY
  the pre-order ticker last, and the buy and sell both filled at the identical
  64409.5 — a round trip crossing zero spread, impossible on a real book. So the
  demo engine simulates neither spread nor book impact at any size we trade, at
  1k or 10k. The demo remains useful for fees, order mechanics, and rejects; it
  is worthless for the slippage arm of §6.3. No more effort should go into
  making demo slippage meaningful.
- **Slippage now measured where it exists** (`sampleSpread()`, hourly at :07):
  §6.2 defines slippage = max(half-spread, 0.03%), and half-spread is directly
  observable on Kraken — the venue we actually model costs for — with a public
  read-only quote and no orders. Reuses `IngestionService.createExchange()`
  (now public) so it quotes the same venue as ingestion. Journaled as
  ops/spread-sample; calibrate-report prints median/p90/max and counts how often
  reality exceeds the model. Records evidence only; changes no gate.
- **First reading: the model is PESSIMISTIC, which is the safe direction.**
  Kraken BTC/USDC half-spread 0.0025% vs the flat 0.0300% the model charges —
  the model over-charges slippage by ~12×. Per §6.2 ("all go/no-go decisions are
  made on pessimistic-mode numbers") that is correct behaviour, not a bug. One
  sample is not a distribution; the hourly cron builds one. Watch for the
  opposite sign — if median half-spread ever exceeds 0.03%, the model is
  under-charging and paper results turn optimistic.

## 2026-08-10 — Mirror coverage is now auditable (soak-check finding)

- Soak-check found the kill-switch flatten (journal #126, 08-09 21:38) produced
  no `demo-fill` AND no `mirror-error`: the demo keys were not yet in the
  container env, so `mirrorFill` hit `if (!this.enabled) return` and vanished
  silently. One §6.3 pair lost; unrecoverable (never journaled).
- `bybit-demo-mirror.service.ts`: that early return now journals
  `ops/mirror-skip-disabled` with the reason (no keys vs. `broken` earlier this
  process). A disarmed mirror no longer looks identical to a healthy one.
- Same file: `journalEvent` now swallows+logs insert failures. It is awaited
  inside `mirrorFill`, which `PaperBrokerService` awaits — a failed journal
  insert could have thrown into the paper loop, against the AGENTS.md invariant
  that mirror errors can never break it. (The `mirror-skip-stale` path had this
  hole too; fixing it in `journalEvent` covers every call site, so the
  now-redundant `.catch()` on the `mirror-error` insert came out.)
- `calibrate-report` prints `Mirrors skipped (off)` so coverage gaps count
  instead of reading as full coverage. Historical fills stay at 0 — the events
  were never written, so nothing is retroactive.
- Verified: typecheck ✓, `pnpm build` ✓, `pnpm test` (18 core) ✓, rebuilt image
  and confirmed both files landed in `dist/`, agent healthy after restart.
  Untested at runtime: the disabled branch itself — it only fires on a fill
  while the mirror is off, and fills are 1-2/month.

## 2026-08-10 — Claude Code migration + §6.3 calibration mirror

- Created AGENTS.md / CLAUDE.md / .claude/commands/soak-check.md / this file.
- Built the §6.3 calibration layer:
  - `BybitDemoMirrorService` — mirrors every FRESH paper fill as a real market
    order on Bybit demo (api-demo.bybit.com, spot BTC/USDC); journals
    `demo-fill` linked by `paperFillId`; stale (replayed) fills skipped;
    all errors isolated as `ops/mirror-error`, can never break the loop.
  - `PaperBrokerService.journalEvent` now returns the inserted journal id;
    buy/sell call the mirror after journaling.
  - CLIs: `demo-ping` (read-only key/market/balance check),
    `calibrate-report` (§6.3 modeled-vs-real cost comparison, 30% gate,
    honest coverage accounting).
- Bybit demo keys verified (first attempt failed with retCode 10003 — keys were
  from the MAIN account; demo keys must be created inside Demo Trading mode).
  Demo wallet funded: 50k USDC, 50k USDT, 1 BTC, 1 ETH.
- Agent redeployed via `docker compose -f docker-compose.local.yml up -d --build`;
  verified `bybit-demo-mirror.service.js` inside the container; loop resumed,
  replayed missed candles correctly (all holds; stale-guard would have blocked
  mirroring of replayed fills).
- Decision: stay single-pair (BTC/USDC) for V1 — per SPEC §2.2 and the §7
  discipline. Expected trade rate for donchian(40,10) 4h: ~1-2 round trips per
  month, clustered; multi-week flat stretches are normal (long-only, flat in
  bear = success). Rational frequency band for this fee tier (~0.5-0.6%/round
  trip): holds of days-weeks; watch fee+slippage share of gross P&L (§7.3),
  >~30% means trading too often.
- OPEN: daily calibration probe (tiny scheduled buy+sell round trip through
  both PaperAdapter model and Bybit demo) to accumulate §6.3 pairs faster
  than the strategy's sparse entries. Agreed useful, not yet built.

## 2026-08-09/10 — Kill-switch drill (SPEC §4.1.4) — PASSED

- 21:38:19Z `kill-switch on`: journaled ops event (#125) + flatten fill (#126):
  sold 0.0153889 BTC @ 65,085.62, fee 2.60, round-trip pnlNet −1.31 USDC
  (price moved +84 in our favor; fees ate it — cost math lesson).
- 22:02 tick: loop correctly SILENT (no decision journaled) while ingestion
  kept advancing lastCandleTs — data flows, trading halted. ~9h parked overnight.
- 06:43:22Z `kill-switch off` (#127); loop resumed on the next tick with
  correct catch-up replay. Kill switch now proven end-to-end.

## 2026-08-09 — Moved agent from terminal to Docker (soak start)

- Added `docker-compose.local.yml`: agent containerized with
  `restart: unless-stopped`, SAME compose project + `pgdata` volume as dev
  compose → zero data migration; db port 55432 still published for host tools.
- Switchover was clean: journal ids continuous (#116 terminal → #117/118
  container), no missed candles. Note: killing the dev terminal also killed the
  dashboard (it is not in compose; restart with
  `pnpm --filter @microtrading/dashboard dev`).
- Soak constraint: Mac must not sleep (plugged in / sleep disabled), else the
  loop pauses silently.

## 2026-08-07 → 09 — First live paper days

- 2026-08-07 00:02Z paper account created (10,000 USDC).
- 2026-08-07 12:02Z first entry: BUY 0.0153889 BTC @ 65,001.49 (fee 2.60),
  reason "4h close above 40-candle high 64951", stop 64,078.75.
- ~65 hourly ticks with zero misses; ingestion clean ("167 1h candles, no
  gaps" every hour). Max drawdown ~-0.08%. Position held until the drill
  flatten (see above). Infrastructure verdict: solid. Strategy verdict:
  needs weeks/months, not days (1 trade = no evidence).

## Current status snapshot (2026-08-11)

- Soak: RUNNING (Docker, auto-restart). Flat, cash 9,996.09 USDC — unchanged by
  any of the 08-11 probe work, as intended.
- Phase 3 checklist: dashboard ✓ watchdogs ✓ kill-switch drill ✓ soak running ✓
  §6.3 mirror armed ✓ *and now actually capturing prices* ✓ daily probe ✓ —
  remaining: ≥2 weeks of pairs, then calibrate-report verdict; 4-week soak clock
  runs to ~2026-09-06.
- **§6.3 splits into two arms, and only one of them lives on Bybit demo**:
  slippage is measured from Kraken half-spread samples (hourly, read-only);
  fees/mechanics from demo fills. Demo slippage is structurally 0 and should be
  ignored. §6.3 text remains UNAMENDED — the gate still reads on strategy fills;
  if the human wants the gate itself to reflect this split, that is a spec
  decision, not a code one.
- Version control exists as of 2026-08-11 (`git init`). Commit before soak-
  affecting changes; the mirror bug above went 1 day undetected with no history.
- Next phase gate: Phase 4 (LLM analyst) only after §6.3 calibration passes.

## 2026-08-16 — Calibration re-run, slippage drift, holdout sealed by decision

- Soak healthy: containers up 4 days, 48/48 hourly decision+equity pairs over
  48h, zero risk/mirror-error/stale-data-halt/tick-error entries. Flat,
  9,996.09 USDC. Donchian(40,10) channel 62,740–65,500, close 63,078 (3.8%
  below entry).
- `calibrate-report`: 14 probe pairs at the current basis, 0 mirror errors.
  §6.3 verdicts unchanged — fees PASS, slippage PASS, mechanics PASS, fill-model
  -vs-venue NOT EVALUABLE (and structurally unclosable on a zero-spread demo).
- **Slippage claim in AGENTS.md was stale and is corrected.** At n=1053 the
  0.03% floor is conservative at p90 (0.0278%) but NOT per-sample: 62 samples
  (5.9%) exceed it, all on AVAX (24/103, max 0.044%), ADA (20/103, max 0.057%),
  ARB (18/103, max 0.061%). Steady ~6%/day since 08-12, not hour-clustered.
  BTC/USDC — the only traded pair — has zero breaches, so the live loop's fill
  model stays pessimistic; the optimism lands on the pooled evaluation. Left
  uncorrected in the model: per-pair slippage is a cost-basis change and D3
  froze the spec. Disclosed in REPORT §11 instead.
- **Decision: the holdout will NOT be opened.** Recorded in REPORT §1.1 with the
  reasoning. §7.4's live gate is conjunctive; three conditions are unassessable
  until 2026-11-07 at the earliest (≥3mo paper, positive net — currently −3.91
  USDC, tracking error whose axis is NOT EVALUABLE), and two already fail on dev
  (59 effective trades of 100; DSR 0.82 of 0.95). A favourable holdout yields a
  wait, not a pass; an unfavourable one ends a project already at its stopping
  rule. Spending the one-shot control — the thing D2 and D3 both name as what
  contains their after-the-setback timing — to learn something that changes no
  present action is its weakest possible use. It stays sealed for a successor
  project with a genuinely new hypothesis.
- REPORT.md is now DRAFT pending §10 only (soak completes 2026-09-04). §12
  unblocks then. Three families evaluated, two killed — the §7.4 stopping-rule
  precondition is met and exceeded.
- Next phase gate, restated: Phase 4's precondition ("only after §6.3 passes")
  is met on every axis that CAN pass. Axis 4 needs a real-book venue and will
  not close on demo, so it is not a thing to wait for.

## 2026-08-20 — 47h soak outage (laptop down), catch-up replay

- **Outage: 2026-08-18 21:07Z → 2026-08-20 20:30Z (~47.4h).** Cause: the Mac
  hosting the Docker stack was down. Confirmed by the human. Not a fault —
  the journal stops cleanly (last decision 21:02Z, last spread sample 21:07Z)
  with zero `risk` / `tick-error` / `mirror-error` / `stale-data-halt`
  entries. Containers back up 20:30Z, `loopEnabled: true`, `killSwitch: false`.
- State at the moment of the outage, carried across it unchanged: LONG
  0.0154213 BTC @ 64,839.65 (entered 08-18 16:02Z, "donchian entry"), stop
  64,030.76, last mark 64,544.10 (0.80% above stop), equity 9,990.53.
- **What fills itself:** the 1h series and the paper record. `runOnce()`
  backfills 7 days of candles from Bybit REST, then replays every candle past
  `lastProcessedTs` (`MAX_REPLAY = 500`; ~47 needed, so no truncation) with the
  full per-candle sequence — pending fill at open, pessimistic stop check, day
  roll, equity point, decision. Replayed decisions are journaled with
  `replayed: true`. The stop may therefore trigger retroactively inside the gap;
  that is the intended §6.2 behaviour, not a defect.
- **What is permanently lost, and cannot be reconstructed:**
  - ~47 hourly spread samples × 10 pairs (~470 rows). The sampler reads live
    top-of-book via `fetchTickers`; Bybit publishes no historical bid/ask, so
    there is nothing to backfill from. The §6.3 axis-2 evidence base simply has
    a hole from 08-18 21:07Z to 08-20 21:07Z. n and the 5.9% breach rate are
    unaffected in kind — the sample is just smaller than the calendar implies.
  - 2 daily calibration probes (13:37Z on 08-19 and 08-20). A probe run now
    would be a probe dated now, not a backdated one; the cron resumes 08-21.
    §6.3 pair count is 2 short of what the elapsed days would suggest.
- **Soak clock:** the 4-week window still runs to 2026-09-04 by calendar, but
  ~2 of those days produced no observations. Any figure quoted as "N days of
  soak" must be net of this outage or it overstates the evidence.
- No code change. Nothing to fix — the design already fails closed on stale
  data and self-heals on restart, and it did both.
- **Replay outcome (21:02Z):** `catch-up` journaled `missed: 48`, from
  2026-08-18 21:00Z to 2026-08-20 20:00Z. 48 decisions written (47 `replayed:
  true` + 1 live), all `hold`. **No fills — the stop never triggered inside the
  gap.** Position intact at 0.0154213 BTC @ 64,839.65, stop 64,030.76.
  BTC ran to 72,658 during the outage (+12.1% from entry): equity 10,115.66,
  the first time the paper account has been net positive (was −3.91 USDC on
  08-16). Channel now 64,124.4–72,792.3, 4h close 72,664 — 11.7% above the
  exit trigger. Note the stop does NOT trail; the donchian exit channel does
  that job, so the stop sits ~11.9% below mark by design.
- **Code change: `READBACK_MS` 25s → 60s** in `bybit-demo-mirror.service.ts`.
  `calibrate-report` showed `STRATEGY FILLS — 0 pair(s)`: the 08-18 16:02Z
  donchian entry — the only strategy fill in 13 days and the entire §6.3
  axis-3/4 population — filled on demo (`demoFilledQty` set) but exhausted the
  25s read-back budget, so `demoAvgPrice`/`demoFeeUsdc` came back null and the
  pair was excluded. Probe fills the same day read back fine, so this is
  intermittent venue lag past the budget, not a broken path. The 08-11 "4-9s"
  measurement is not an upper bound. Typecheck clean, 6/6 tests, deployed and
  verified in `dist`. This does not change any §6.3 verdict — axis 4 remains
  structurally unclosable on a zero-spread demo — it only stops discarding
  evidence from the rarest event the system produces.
- AGENTS.md slippage figures refreshed (stale for the second time): n=1583,
  92 breaches (5.8%), p90 0.0281%, worst now ARB 0.0891% (~3× the model, was
  ~2×), and SUI has started breaching — four thin pairs now, not three.
  BTC/USDC still zero breaches (n=179, max 0.0074%).
- AGENTS.md `.next` warning widened to cover `pnpm test`, not just `pnpm build`
  — turbo pulls `dashboard:build` into the test task, and running it with the
  dev server up served 500s again today.

## 2026-08-24 — §6.3 axis 2 FAILS; slippage sensitivity says it does not matter

- **`calibrate-report`: slippage axis crossed from PASS to FAIL.** Modelled
  0.0300% vs observed p90 half-spread **0.0324%** (n=2283). It passed at every
  earlier reading (0.0281% at n=1583 on 08-20), so this is a genuine crossing,
  not rounding. Axes 1 (fees, 0.100% = published) and 3 (mechanics, 24 pairs,
  0 mirror errors) still PASS; axis 4 still NOT EVALUABLE — 10 pairs excluded
  at the superseded 0.260% basis, 0 strategy fills mirrored at the current one.
- **A liquidity regime changed on 2026-08-21.** Daily breach rate went ~5%
  (08-13 → 08-18) to 24% / 35% / 27% / 22% (08-21 → 08-24). The breaching set
  widened from four thin pairs to seven: AVAX 71/226, ADA 70/226, ARB 66/226
  (max 0.1807%, 6× the model), SUI 31/226, DOGE 30/226, SOL 8/226, XRP 2/226.
  Clean: BTC, ETH, MNT.
- **Ruled out the benign explanation.** Tick quantisation would predict the
  opposite: those pairs rallied 18–30% over the same window, which makes a fixed
  tick a *smaller* percentage of mid. Average half-spread widened anyway
  (DOGE 0.0112% → 0.0303%, SUI 0.0151% → 0.0282%), i.e. the books genuinely
  thinned against that tailwind. Residual caveat: the agent container also
  restarted ~08-21 after the outage, so an instrumentation artifact is not
  formally excluded — but a bug would have to widen seven pairs systematically
  and leave BTC/ETH/MNT at exactly zero.
- **Confound TESTED and CLEARED (same day).** Sampled all ten pairs from the
  host via raw Bybit v5 REST (`/v5/market/tickers`, `bid1Price`/`ask1Price`) —
  no ccxt, no container, different process and network path — 5 rounds over 90s
  at 13:26–13:28Z, using the sampler's own definition, (ask−bid)/2/mid. Against
  the container's 13:07Z sample, 19 minutes earlier:

  | pair | container 13:07 | host 13:26 | ratio |
  |---|---|---|---|
  | BTC | 0.0001% | 0.0001% | 0.63 |
  | ETH | 0.0002% | 0.0002% | 1.00 |
  | XRP | 0.0165% | 0.0099% | 0.60 |
  | SOL | 0.0260% | 0.0156% | 0.60 |
  | ADA | 0.0222% | 0.0222% | 1.00 |
  | DOGE | 0.0270% | 0.0270% | 1.00 |
  | ARB | 0.0252% | 0.0251% | 1.00 |
  | SUI | 0.0120% | 0.0240% | 2.00 |
  | MNT | 0.0093% | 0.0093% | 1.00 |
  | AVAX | 0.0132% | 0.0264% | 2.00 |

  Five exact matches; the five differences are symmetric in direction (two
  host-HIGHER, three host-lower) and land on exact 1-tick/2-tick ratios — book
  movement over the 19-minute gap, not systematic inflation. A sampler bug
  would have to bias one direction; this biases neither. **The container reads
  the same book the host does. The measurement is sound and the liquidity
  deterioration is real.** Axis 2's FAIL stands on its merits.
- Structural note worth keeping: ADA's minimum possible half-spread at current
  price is one tick = 0.0222%, i.e. 74% of the 0.03% model, so any two-tick book
  is an automatic breach at 0.0444%. Its breach rate is therefore the fraction
  of time the book is wider than minimum tick — which went 21.8% → 51.4%. That
  is genuine deterioration, not a price artifact, and the same reasoning covers
  the other thin pairs.
- **BTC/USDC — the only pair actually traded — still has ZERO breaches**
  (n=249, max 0.0074%). The live paper loop's fill model remains pessimistic.
  The failure bites the pooled 10-pair evaluation, not the soak.
- **Code change: `run-universe` now accepts an optional slippage override.**
  `evaluateParts` already took a `costsOverride` (added for `cost-sensitivity`);
  `run-universe` simply never passed one. Same contract as `cost-sensitivity`:
  unchanged grid, unchanged dev window, one varied input constant, nothing
  recorded, no new selection opportunity, so N is unaffected (§7.1). The banner
  prints a SENSITIVITY RUN warning when the override is active. **§6.2 is
  unchanged** — this measures the damage, it does not amend the model.
  Typecheck clean, agent build clean; baseline run reproduces the 08-12 numbers
  exactly (6/6, best {55,20} PF 2.37, 59 effective, DSR 0.82).
- **Result: the cost model is nowhere near binding.** Re-pricing the grid at
  the observed p90 and beyond, best config {entryLookback 55, exitLookback 20}:

  | slippage | PF | Sharpe | DSR | configs ≥ PF 1.1 |
  |---|---|---|---|---|
  | 0.0300% (modelled) | 2.37 | 0.85 | 0.82 | 6/6 |
  | 0.0324% (observed p90) | 2.37 | 0.84 | 0.82 | 6/6 |
  | 0.0500% | 2.34 | 0.84 | 0.81 | 6/6 |
  | 0.0800% | 2.30 | 0.82 | 0.80 | 6/6 |
  | 0.3000% | 2.02 | — | 0.67 | 6/6 |
  | 0.6000% | 1.71 | — | 0.46 | 5/6 |
  | 1.0000% | 1.41 | — | 0.21 | 2/6 |
  | 1.5000% | 1.13 | — | 0.04 | 2/6 |

  Break-even (PF 1.1) sits near **1.6% slippage — ~50× the modelled rate and
  ~30× the observed p90.** Correcting the model to the p90 costs 0.00 PF and
  0.01 Sharpe. The reason is visible in `fees/gross` = 0.03: this family trades
  rarely and holds long, so a per-trade cost constant barely touches it.
- **Verdict unchanged, and for reasons slippage cannot reach.** Still NOT a
  pass: 59 effective trades of the 100 §7.4 requires, DSR 0.82 of 0.95, and
  observed Sharpe 0.85 below the minimum detectable 1.04. Tightening the cost
  model would not rescue it; neither does the failure sink it. §6.3 axis 2 is a
  real gate failure that must be recorded as such, but it is not the reason the
  strategy has not earned the holdout.
- Holdout NOT evaluated and remains SEALED. No spec amendment proposed.

## 2026-08-24 (b) — Read §7.4 properly; re-evaluated the two dormant families

- **Correction: §7.4's evidence floor was already MET, and has been for weeks.**
  The spec says "no go/no-go judgment on fewer than **100 trades** of
  concatenated OOS + paper history." Donchian's best config has **215
  walk-forward OOS trades** (verified: `evaluateParts` builds windows and counts
  only trades entered inside the test window) plus 4 paper fills. The
  "59 effective" figure is a **tool-side correlation deflation that appears
  nowhere in the spec.** AGENTS.md had recorded it as though it were §7.4's
  requirement. It is a defensible methodological addition — correlated trades
  do carry less information — but it is an unlogged post-hoc tightening of a
  frozen protocol, which is precisely the class of change §7.5 exists to record.
  **Decide it explicitly: log as D4 or drop it.** Until then it is an invisible
  blocker.
- **Correction: the §7.4 kill criteria do not fire on donchian-breakout.**
  PF 2.37 ≥ 1.1 over ≥100 trades; realized DD nowhere near 2× walk-forward DD;
  no 3 consecutive negative months (the account is 17 days old). The strategy is
  not dead and was never close to it.
- **Correction: dev DSR 0.82 is not a gate.** §7.4 requires "deflated Sharpe >0
  at 95% confidence **on the holdout**", and that clause belongs to the *gate to
  live pilot* — which V1 does not pursue, real money being a §1.2 non-goal.
- **Correction: §5.4 is explicitly "V2 preview (not built now)"** and §5.3 pins
  V1 to "max 1 open position (BTC only)". A concurrent-position build would be
  a spec amendment and scope-widening of exactly the kind D3 froze. Withdrawn.
- **The actual blocker was a stale evaluation.** `rsi-reversion` and
  `sma-crossover` are both pre-registered, but their last trials are dated
  **2026-08-06** — before D1/D2/D3. Every number they held was computed at the
  retired 0.26% Kraken single-pair basis. Neither had ever been run pooled at
  0.10% on the universe. Re-ran both (read-only; `run-universe` records nothing,
  so no trial budget consumed, no new selection opportunity):

  | family | configs ≥ PF 1.1 | best | PF | raw | **effective** | DSR |
  |---|---|---|---|---|---|---|
  | rsi-reversion | **0/16** | {25,50,7,30} | 0.74 | 599 | 214 | 0.00 |
  | sma-crossover | **11/12** | {fast 10, slow 200, trendSma4h 30} | 1.99 | 497 | **144** | 0.87 |
  | donchian-breakout | 6/6 | {55,20} | 2.37 | 215 | 59 | 0.82 |

- **`rsi-reversion` is honestly dead** — 0/16 clear the kill line, best PF 0.74,
  Sharpe −0.78, net negative on every config, and it MEETS the evidence floor on
  both raw and effective counts (599/214). That is a clean, well-powered
  negative result and it is one of the two families §7.4's project stopping rule
  asks for.
- **`sma-crossover` clears the effective bar donchian could not**: 144 effective
  trades ≥ 100, because it trades 2.3× more often. It is the first configuration
  in this project to satisfy §7.4's minimum evidence under BOTH the spec's
  literal reading and the stricter effective-count reading.
- Slippage sensitivity on sma-crossover (higher turnover, `fees/gross` 0.06 vs
  donchian's 0.03, so more cost-exposed): at the observed p90 0.0324% the best
  config is unchanged at PF 1.99, DSR 0.86. The grid is more fragile further out
  (11/12 → 8/12 clearing at 0.10% slippage) but the best config holds to 0.20%.
  §6.3 axis 2's failure remains immaterial to the verdict here too.
- **§7.4's project stopping rule does NOT fire.** It triggers when two families
  evaluated honestly yield nothing passing; three are now evaluated at the
  current basis and two clear the kill line.
- Caveats, stated plainly: sma-crossover's Sharpe 0.89 is still below its
  minimum detectable 1.04, so this sample cannot *certify* an edge either way —
  it can only fail to reject one. And picking sma-crossover after seeing dev
  results is a selection decision across families; the DSR's N=34 deflation
  spans all families and is the correct handling, already applied.
- Holdout untouched, still SEALED. No spec amendment made or proposed.

## 2026-08-24 (c) — §7.2 regime reporting built (closes REVIEW R8)

- **New: `packages/core/src/regime.ts`** — pure price-only regime segmentation.
  200-day MA slope (measured over a 20-day lookback, because a 200-day mean
  compared day-over-day is mostly rounding noise and flickers across the sign
  boundary) × drawdown from running peak, threshold 20%. Four segments: `bull`,
  `topping`, `rebound`, `bear`. Classified from PRICE ONLY — never from anything
  the strategy knows, or a strategy could define its own favourable weather.
  Warm-up days carry `label: null` and are excluded from every bucket rather
  than folded into one; otherwise the first ~7 months of each pair get silently
  attributed to whatever label happens to be the default.
  8 unit tests (`packages/core/test/regime.test.ts`), core suite now 36/36.
- **`run-universe` now prints the §7.2 tables** for the config the verdict is
  about: per regime segment and per calendar year, each with pair-days,
  **exposure %**, trades, net% and PF — plus an explicit long-only bear verdict.
  Exposure is counted in pair-days (a day with any open position on a pair
  counts once for that pair). Trades are attributed to the regime they were
  ENTERED in; attributing by exit would credit decisions to information they did
  not have.
- **Both surviving families PASS the §7.2 bear test.** They stand aside when the
  trend is against them, and the little they do trade there is profitable:

  | family | bear exposure | bear trades | bear net% | bear PF |
  |---|---|---|---|---|
  | donchian-breakout {55,20} | 10.3% | 63 | +11.8% | 4.91 |
  | sma-crossover {10,200,30} | 16.2% | 143 | +28.6% | 4.31 |

- **But the calendar-year tables are the real finding, and R8 called it exactly.**
  Both families are carried by a single year and both are NEGATIVE in the most
  recent one:

  | year | donchian net% / PF | sma-crossover net% / PF |
  |---|---|---|
  | 2022 | 0.0 / n/a (no trades) | 0.0 / n/a (no trades) |
  | 2023 | +18.8 / 3.64 | +25.5 / 3.52 |
  | 2024 | **+76.0 / 2.96** | **+96.9 / 2.84** |
  | 2025 (to 08-01) | **−2.4 / 0.88** | **−10.6 / 0.70** |

  The aggregate PF of ~2 that both families advertise is substantially one
  calendar year. 2025 — the dev period closest to the holdout and to live
  conditions — is net negative with PF below 1 for both. This is precisely the
  regime dependence R8 warned about, and it was invisible in the aggregate.
- **Action this implies: do NOT take either family to the holdout yet.** The
  holdout is the most recent 12 months and burns once; walking into it off a
  result that is one good year plus a deteriorating one is how you spend the
  only clean sample you have. Check first whether §7.4's third kill criterion —
  "3 consecutive calendar months net negative" — fires inside 2025. That needs
  monthly granularity, which the current tables do not have; it is the obvious
  next piece of reporting.
- Interpretation caveat worth keeping: drawdown is measured from the RUNNING
  peak, so the 2021 all-time high keeps most of 2023–24 classified deep-drawdown.
  That is why `rebound` (3630 pair-days) swallows the sample and `bull` (1530) is
  small. It is a faithful description — those prices genuinely were far below the
  prior peak — but the bull/rebound split should not be read as "the market was
  not rising". The bear test is unaffected: `bear` additionally requires the MA
  slope to be negative.
- No container redeploy: the change is a new core module plus CLI reporting,
  neither of which the trading loop calls. Redeploying would restart the soak
  for nothing.

## 2026-08-24 (d) — Monthly granularity: the result is ONE month

- Added the calendar-month table, §7.4's "3 consecutive months net negative"
  scan, and a **concentration diagnostic** to `run-universe`. Months are walked
  over a continuous calendar range so a data gap cannot silently join two
  negative stretches into one apparent run; a no-data month breaks a run (an
  unknown month is not evidence of a negative one) and so does a flat month
  (§7.2 is explicit that flat is not failure).
- **The finding that matters. Both surviving families are one month.**

  | family | full period | ex-2024-11 | 2024-11 alone | share | negative months |
  |---|---|---|---|---|---|
  | donchian-breakout {55,20} | +104.0% | **+24.1%** | +64.4% | **77%** | 12/25 |
  | sma-crossover {10,200,30} | +120.9% | **+25.0%** | +76.8% | **79%** | 9/25 |

  Remove November 2024 — the post-US-election crypto rally — and three years of
  pooled, 10-pair, walk-forward out-of-sample trading returns ~24-25% total,
  roughly 8-9%/year, with 36-48% of months negative. The advertised PF of 2.37
  and 1.99 are, to a first approximation, descriptions of that one month.
  This is what DSR 0.82 / 0.87 was already trying to say, and what the aggregate
  hid completely. REVIEW R8 predicted exactly this failure mode.
- **§7.4's third kill criterion fires for both** — donchian a 3-month negative
  run ending 2024-06, sma-crossover ending 2024-08. Calibration note, stated so
  nobody over-reads it: over 25-37 active months a run of exactly 3 negatives is
  unremarkable for any noisy series, and both hit exactly 3, never more. The
  criterion reads like a live-account circuit-breaker that happens to be
  evaluable on a dev window, not like a considered dev-window test. **The
  concentration finding is the real evidence; the kill trigger is incidental.**
  §7.4 scopes kill criteria to "OOS/paper" and these ARE pooled walk-forward OOS
  months, so it is legitimately evaluable — but whether a dev-window run kills a
  family is a reading a human must make. The tool says so and does not decide.
- Both families still PASS the §7.2 long-only bear test (10.3% and 16.2% bear
  exposure). That result stands and is genuinely good — they do stand aside.
  It is simply not sufficient: standing aside correctly in bear markets does not
  establish an edge if the entire profit came from one month of one bull run.
- Core suite 36/36, agent typecheck clean. No container redeploy (CLI reporting
  and a new core module; the trading loop calls neither).

## 2026-08-24 (e) — November 2024 attribution: market-wide, but half of it is two pairs

- Added per-pair attribution of the concentrating month to `run-universe`'s
  concentration block (`attributeMonth`), reporting BREADTH and CONCENTRATION
  separately — breadth alone flatters, since "7 of 10 pairs up" can still be two
  pairs carrying the month. Shares are LOG shares; returns compound, so the
  arithmetic share of a large move overstates it (77% arithmetic vs 70% log for
  the same quantity). Put in the tool rather than a throwaway script because
  REPORT.md Appendix A promises every number is reproducible from the listed
  commands.
- **Answer: genuinely market-wide.** donchian 7 of 10 pairs positive in 2024-11,
  sma-crossover 6 of 10. Not a single-pair artifact.
- **But within the month it is two pairs.** XRP + ADA are 71% (donchian) and 74%
  (sma-crossover) of that month, which is **50% and 53% of each family's ENTIRE
  three-year result — on 2 and 3 trades respectively.**
- **Both families picked the same two pairs in the same month.** That is direct
  visible evidence that donchian-breakout and sma-crossover are substantially the
  same trade wearing different parameters — the correlated-trials problem that
  the DSR's N=34 deflation exists to price, showing up in the open rather than as
  a statistical abstraction. It also explains why their aggregate PFs, Sharpes
  and DSRs sit so close together despite quite different entry logic.
- Report §1.1 updated with the attribution table and the corrected log shares.
- This is the last analysis this evidence supports. Next: draft §10
  (infrastructure result), which is the project's actual deliverable under
  §7.4's stopping rule.

## 2026-08-25 — Decision: Phase 4 (LLM analyst) starts after the soak, scoped to observability

- **Decision, recorded before the fact.** Phase 4 begins once the Phase 3 soak
  completes **2026-09-04** and §10 of REPORT.md is written. Logged now, while no
  LLM feature exists and no LLM output has been seen, so the scope below cannot
  be read as having been chosen to fit a result. This is a roadmap sequencing
  decision, not a protocol deviation — §7.5 is untouched and N stays 34.
- **Why it is worth doing at all.** §1.2 goal 3 — "evaluate where AI genuinely
  adds value vs. where deterministic code is better" — is the only stated project
  goal with no evidence behind it. All three families are deterministic
  indicators; the repo contains zero LLM code (`grep -riE 'anthropic|openai|llm'
  over apps/ and packages/` returns nothing). The project is named for a
  capability it does not have.
- **Why the timing is the binding constraint, and the one thing genuinely worth
  hurrying.** §2.5 hard rule 2 forbids synthesizing LLM features for past dates:
  a feature exists only from the moment it was generated live and journaled.
  The forward-evaluation clock therefore cannot be backfilled, simulated, or
  caught up — every un-journaled day is evidence permanently unavailable. This is
  the opposite of the strategy-family question, where more work costs N and buys
  nothing.
- **SCOPE COMMITMENT — observability only, no strategy consumes LLM features in
  V1.** The analyst writes regime commentary, news/context features and
  post-trade reviews into the append-only journal as recorded observations.
  Nothing reads them back into a signal. Consequences, stated so this cannot
  drift later:
  - It adds **zero trials**. Nothing is being selected on, so DSR's N stays 34
    and no already-published number is re-deflated.
  - It cannot touch the order path (§2.5 hard rule 1, §4.1 constraint 2), and it
    inherits the mirror discipline: all analyst errors are caught and journaled,
    never able to break the paper loop.
  - **Grid-searching prompt variants and keeping the best is forbidden.** That is
    the multiple-testing problem in new clothing and would silently raise N.
- **Honest ceiling, agreed up front so the writeup does not overclaim.** D1
  records this strategy's turnover as 10-25 round trips/yr on one pair, so three
  months of forward paper yields roughly **3-6 round trips**. §7.4's floor is 100
  trades. The §2.5-mandated LLM-off ablation would compare two samples of a
  handful of trades each — an anecdote, not an experiment. Phase 4 in V1
  delivers a working, look-ahead-safe, journaled integration and starts the
  clock. It does **not** deliver a verdict on whether AI adds value, and the
  report must say so.
- **Blocker to close before Phase 3 can be called done:** §6.3 axis 2 (slippage
  vs the sampled book) is currently **FAIL** — p90 0.0324% against a 0.03% model,
  278/2283 samples breaching across seven pairs. Phase 3's definition of done
  includes the calibration gate. Either the model is corrected or the failure is
  recorded as a known limitation in REPORT §8 with the pooled-evaluation impact
  stated. Not a Phase 4 problem, but it must not be skipped past on the way there.

## 2026-08-25 (b) — Stress test of the docs against the ledger; findings applied

- **`docs/STRESS-TEST-2026-08-25.md`** — a second adversarial review, this time
  checking SPEC/REPORT claims against the `experiments` table, the git log and
  the code rather than against the prose. The human delegated the judgment
  calls ("answer it yourself using trusted sources") and gave a green light to
  apply. Every decision below is therefore recorded with its reasoning, and
  none touches the trading loop during the soak.
- **The finding that matters — D0.** The ledger shows donchian-breakout was
  pre-registered at 23:03:43Z on 08-06, five minutes after rsi-reversion's
  results and nine after sma-crossover's. The code comment ("the structural
  answer to the cost drag that killed both 1h families") and the grid note
  ("the stopping rule already triggered once") both say the family was chosen
  after the first two failed — and §7.4 said stop at two. This was the first
  widen-after-a-setback, three days before the log existed, and it was not in
  §7.5. REPORT §4 called the choice "fixed ex ante" and §1 called running a
  third family "met and exceeded". N=34 already prices the selection, so no
  number changes; the register and the narrative were wrong. **Logged as
  SPEC §7.5 D0 (backdated, timing "after"); REPORT §1, §4, §11 corrected.**
- **§7.1.3 was being violated.** `run-universe` recorded nothing; the ledger
  had zero pooled-universe rows, so PF 2.37 / 1.99 / 0.74, DSR, regime and
  concentration existed only as prose. `ExperimentService.logEvaluation` +
  `run-universe` now write a `kind='evaluation'` row (params hash, git SHA,
  costs, sensitivity flag, universe, headline metrics), excluded from N.
  First rows: **#44 donchian** (PF 2.37, DSR 0.82, N=34 — reproduces 08-12
  exactly), sma-crossover and rsi-reversion recorded the same session.
- **"Committed to git before any backtest" was never true** — repo initialised
  08-11, registrations 08-06 with `git_sha='no-git'`. Journal half held (11–15s
  before first trial). REPORT §4 now says so.
- **Clarifications C1–C8 logged in §7.5** (a new list, distinct from
  deviations: readings of frozen text that turned out unevaluable or ambiguous,
  with timing). Decisions taken by the agent under delegation, with reasoning:
  - C1 §6.3 read as four axes (in force since 08-11, unlogged until now).
  - C2 §7.4 "100 trades" = raw; effective N is disclosure only. Reason: the DSR
    already absorbs sample size; a second deflation was post-hoc tightening.
  - C3 kill criteria scoped: 3-month rule on pooled concatenated OOS+paper,
    calendar months, flat/no-data breaks a run, a dev-window fire kills. Under
    this reading BOTH surviving families are killed by §7.4 itself (donchian to
    2024-06, sma to 2024-08). Reason: §7.4 lists it under "OOS/paper" kill
    criteria; reading it as paper-only would make it unevaluable for months
    and exempt the one window where it is actually measured.
  - C4 `HOLDOUT_FROM` pinned at 2025-08-01 (was `now − 12mo` at registration —
    a September family would have received 2025-09-01 and its dev window would
    overlap the sealed holdout); one holdout evaluation TOTAL, not per family.
  - C5 total N ≤ 45 across all families (MinBTL), enforced in `preregister`.
  - C6 soak = 28 days at ≥95% tick coverage, outages extend → **ends
    2026-09-06 00:02Z**, not 09-04. Decided now so it cannot be chosen after
    seeing the last week.
  - C7 §10 not amended (would be a D4); REPORT §10.1 scores the DoD clause by
    clause instead — "1h candles" differs, "holdout report" unmet by decision.
  - C8 evaluation rows (above).
- **SPEC Appendix D — Errata.** ~20 stale statements in the frozen §§1–10
  (Kraken everywhere, SQLite, 2019 backfill, VPS runtime, CI, EUR reporting,
  weekly cutoff, native stops, reconciliation, maker model…) each mapped to
  current truth. Frozen text untouched; header bumped to v0.3.1 with a
  reading rule. REPORT §10.2 carries the specified-vs-built table.
- **REPORT internal contradiction fixed:** §1.2 still argued from the
  59-effective floor and dev DSR that §1 had withdrawn; rewritten to stand on
  the conjunctive gate + C3 + concentration. Stale figures refreshed (−3.91
  USDC → +153.97 after a +17.1% signal round trip; "one real trade" → five
  fills; §2 power now per family: 0.85 and 0.89 vs 1.04; §6 pair-years
  stated for both total and dev window).
- **Code (ops/CLI only, no loop change, not deployed):**
  `experiment.service.ts` — `HOLDOUT_FROM`, `MAX_TOTAL_CONFIGS`,
  `logEvaluation`, `countDistinctConfigsAllFamilies` keyed by (family, hash)
  so a future family sharing a parameter vocabulary cannot merge into an old
  one; `run-universe.ts` — records the run; `monitor.service.ts` —
  `deadMansPing()` on the 15-min health cron, gated on `HEALTHCHECK_PING_URL`.
  Reason for the ping: every alert is sent by the process being monitored, so
  the 47h outage produced silence; an external service that alerts on
  *absence* of pings is the only thing that catches a dead host. Ships gated
  off; needs the URL in `.env` and a container redeploy — deliberately not
  done mid-soak. Typecheck clean, core 36/36.
- **`docs/PHASE4-PREREG.md`** written: the eight §2.5 holes closed before any
  API call (triggers, no news source in V1, pinned JSON schema, prompt+model
  hash per row, cost cap, mirror-style isolation, kill-switch pause, no
  strategy consumes features). Model pinned `claude-opus-5`.
- Nothing committed; the human commits.

## 2026-08-25 (c) — Dashboard said "Calibration probe: never"; planned restart

- Opened the dashboard in the browser. **"Calibration probe: never"** while
  the journal shows probes at 13:37Z on 08-21, 22, 23, 24 (two demo fills
  each). Cause: `StatusController.health().latest()` scanned only the last 60
  `ops` rows and filtered in JS; the spread sampler writes 10 ops rows an hour,
  so any event rarer than ~6-hourly fell out of the window. Same latent bug
  would have hidden `lastSpreadSampleAt` had anything else flooded `ops`.
  Fixed at the root: filter by `payload->>'event'` in SQL, `limit 1`; 0.3 ms
  via backward index scan. Typecheck clean.
- **Planned agent restart 13:24:20Z → 13:24:44Z** (`up -d --build agent`),
  between ticks; zero ticks lost, loop re-armed, `lastProbeAt` now
  `2026-08-24T13:37:00Z`, position and stop unchanged. Ships the (gated-off)
  `deadMansPing` too, so setting `HEALTHCHECK_PING_URL` later needs only a
  restart. Not an outage under C6; logged so the soak record shows it.
- The Next.js dev overlay's "1 issue" is a hydration warning from
  `data-locator-target="webstorm"` injected into `<html>` by the WebStorm
  browser extension — not project code, ignore.

## 2026-09-25 — Demo mirror read-back: recover lost strategy fills

- `/soak-check` found 20 hourly `tick-error`s 2026-09-20 11:02Z → 09-21 06:02Z
  (`getaddrinfo EAI_AGAIN api.bybit.com` — host DNS, not the code) plus one probe
  `mirror-error` at 09-20 13:37Z. The 7-day decision count is 168/168 afterwards,
  i.e. the ticks were replayed on recovery. Logged here; not investigated further.
- **3 of 7 strategy mirrors had null price/fee** (`readbackTrades: 0`): 08-18,
  09-18, 09-23 — all at **16:02Z**; the 4 at other hours read back in 2–9 s.
  Queried afterwards, Bybit demo shows the orders executed in 0.6–1.3 s, yet
  `fetchMyTrades` returned nothing for the whole 60 s budget (no errors in the
  logs). The 08-20 budget raise 25 s → 60 s did not fix it. `fetchOrder(…,
  {acknowledged: true})` carries avgPrice and cumExecFee for the same orders.
- Fix (`25f9512` + follow-up): `mirrorFill` falls back to `readbackOrder()`
  and journals `readbackSource`; new `backfill-demo-readback` CLI appends
  `demo-fill-readback` rows (append-only, idempotent); `calibrate-report`
  overlays them. Recovered 09-18 buy @ 80,669.5 and 09-23 sell @ 83,703.2.
  **Unrecoverable:** the 08-18 entry and 4 probes from 08-11/12 — demo no longer
  returns orders that old (~30-day retention, observed).
- Axis 4 strategy population 4 → 6 pairs; total deviation +226.9% → +180.6%,
  still FAIL. Most of it is timing, not spread: paper prices at the candle open
  (:00) or the stop level, demo market-orders at :02 (09-23 exit: 0.35%).
- Axis 3 printed "NOT EVALUABLE — no complete pairs" with 92 pairs:
  `mechanicsOk` required `mirrorErrors === 0` and the 09-20 DNS outage produced
  one. Fixed (`ee25224`): errors that never reached the venue (DNS/timeout/
  connection) are counted apart; only venue errors FAIL the axis. Now PASS.
- Hazard fixed (`ee25224`): every CLI booted the full AppModule incl.
  `ScheduleModule`, and the host `.env` has `ENABLE_TRADING_LOOP=true` — a CLI
  alive at :02 would tick a second paper loop (and :07/13:37 would duplicate
  samples/probes). The scheduler is now registered only via
  `AppModule.withScheduler()` in `main.ts`. (The backfill itself had been run
  with the loop/probe flags overridden to false.)
- Three planned agent restarts 16:28Z–16:31Z, between ticks.

## 2026-09-25 (b) — Soak verdict (C6): NOT MET, 93.9% live tick coverage

- Nothing was logged between 08-25 and today; the soak ended 09-06 00:02Z with
  no verdict recorded. Computed now from the journal, applying C6 as written:
  720 candles in the window, minus the declared 47 h outage = 673 due; 632 ran
  live (88 replayed by catch-up — decided, but never fillable live). **93.9%.**
- Misses: host asleep 08-22 16Z→08-23 11Z (18; the :07 sampler fired once in
  19 h, so the whole Docker VM was paused) and 08-31 20Z→09-01 08Z (11, never
  logged at the time); kill-switch drill 08-09/10 (9); 08-07, 08-12, 08-24 (4).
- Excluding the drill would read 632/664 = 95.2% (PASS). **Not adopted**: C6
  was written after the drill and named one outage; picking the reading that
  flips the verdict after seeing it is the §7.5 timing problem. Recorded as
  SPEC §7.5 C9. Decided under the 08-25 delegation (memory: decide protocol
  calls from the sources, log, proceed).
- Consequence: Phase 4 is observability-only (N unchanged) and not gated on
  the verdict → proceeds, 19 days late. The real lesson is §8's: this Mac is
  not an ops platform, and its sleeps are silent without the dead-man ping.

## 2026-09-25 (c) — REPORT §10/§12 written; calibrate-report sign bug

- REPORT is FINAL for V1: §10 (infrastructure result, C9 verdict, miss table),
  §10.1 row "unattended ≥4 weeks" → Unmet, §12 conclusion, stale soak prose
  fixed. This was the last precondition PHASE4-PREREG §0 sets for Phase 4.
- **Bug, found while writing §10:** `calibrate-report` measured demo slippage
  as `|demoAvg − ref|`. Favourable drift was booked as cost: the 08-25 stop exit
  sold 654 USD ABOVE its reference and counted +8.26 USDC. Now signed
  implementation shortfall (Perold 1988; buy +, sell −). Strategy axis:
  +948% "model under-charges" → **−128%, model over-charges** — still FAIL
  under |dev| ≤ 30%, so the fix does not flip the verdict, it flips the
  direction. Four of six strategy fills were favourable; it is ~2-minute
  timing drift after the candle open, n=6, evidence of nothing. Probe
  slippage signed ≈ 0 (demo fills at last with zero spread, as known).
  Earlier today I told the human the reverse from the |·| numbers; corrected.
- Host `pmset`: AC `sleep 0`, battery `sleep 1` — the soak's misses are
  battery/lid sleeps. Fix needs sudo or a VPS; left to the human.

## 2026-09-25 (d) — Phase 4 analyst built and deployed OFF

- Preconditions (PHASE4-PREREG §0) met today: soak ended, REPORT §10 written.
- **Model changed to `claude-opus-5-5` by human decision**, before any call —
  PHASE4-PREREG Amendment 1, which also records `max_tokens` 4,000 (thinking
  counts toward it), 60 s timeout, and no refusal fallback (it would change the
  model inside the series).
- `apps/agent/src/analyst/`: polls the journal every 5 min for fill / risk /
  kill-switch / stale-data-halt rows; daily commentary at 06:10Z. The loop is
  untouched and has no reference to it; the module does not import
  TradingModule, so there is no path to the broker or kill switch. Caps in code:
  50 calls/UTC day, 8k input (`countTokens` first). Structured output via
  `output_config.format` json_schema; provenance hashes on every row. First
  start sets the cursor to the journal's end — no past events are analysed.
  Routing checked 10/10 against the built module; no API call has been made.
- Deployed with `ENABLE_LLM_ANALYST` unset → inert. **To start the forward
  clock the human adds `ANTHROPIC_API_KEY` and `ENABLE_LLM_ANALYST=true` to
  `apps/agent/.env` and redeploys.** Added dependency: `@anthropic-ai/sdk` 0.128.

## 2026-09-25 (e) — TypeSafe Jev guardrail on analyst rows (Amendment 2)

- Evaluated TypeSafe (docs.typesafe.ai): typed yes/no / choice / score
  judgments with trained-calibrated probabilities, $0.042/MTok input, text
  only. Rejected for anything a strategy reads (new family, N) and for numeric
  work code already does (regime.ts, spread sampler). Adopted as a CHECK on the
  analyst: PHASE4-PREREG Amendment 2 written before the first call.
- `analyst-check` rows after every analyst row: `predictsPrice`,
  `recommendsTrade`, `contradictsInputs`; pinned `jev-1.13.0`; never blocks
  or re-asks. Gated on `TYPESAFE_API_KEY` (present in the container) — inert
  until the analyst itself is enabled.
- Smoke test, synthetic, not journaled: clean 0.13 / 0.09 / 0.08, deliberately
  violating 0.99 / 0.98 / **0.59**, ~0.7 s, ~610 tokens. The language checks
  are sharp; the numeric-contradiction check is weak (91,200 claimed vs
  83,800.9 given scored only 0.59) — a text model reading numbers, as expected.
  No threshold set, per the amendment.
- Redeployed ~16:52Z during the kill-switch drill; the flag survived the
  restart.

## 2026-09-25 (f) — Kill-switch drill #2: PASSED; Phase 4 forward clock started; dashboard

- Drill (overdue since ~09-09), run while flat: ON 16:40:57Z (`kill-switch on`
  row #11888; nothing to flatten) → flag survived a 16:52 container restart →
  17:02 tick logged "Kill switch is ON — flat and halted", wrote no decision,
  lastProcessedTs held at 15:00Z → OFF 17:02:48Z (#11889) → 18:02 tick:
  `catch-up` missed 2 (#11901), 16:00Z decided `replayed: true`, 17:00Z live,
  lastProcessedTs 17:00Z. Equity unchanged 10,143.47. Cost: one live tick.
  The 17:02 halt line also proves crons still fire under
  `AppModule.withScheduler()`.
- Redeployed 17:02:51Z with the human's `ANTHROPIC_API_KEY` +
  `ENABLE_LLM_ANALYST=true`. **Phase 4 forward clock started 2026-09-25
  17:05:00Z** — `analyst-started` #11890, cursor #11889, zero calls for past
  events. `HEALTHCHECK_PING_URL` still unset.
- Dashboard: Analyst card (latest note + its guardrail probabilities, plain
  numbers — Amendment 2 sets no threshold); feed sentences for analyst /
  analyst-check / analyst-* ops rows; fixed the catch-up line reading a
  non-existent `candles` field (payload has `missed`).

## 2026-09-28 — Health check; Phase 4 window fixed at 30 days (Amendment 3)

- Check 12:02Z: 67 live ticks since the drill (66 expected + the resume
  tick), no gaps, no errors, no risk rows; flat, 10,143.47. Three daily analyst
  notes (09-26/27/28 06:10Z, ~$0.04 each, ~10 s); guardrail max predictsPrice
  0.68 on 09-26 ("fits a rebound now pausing" — forward-leaning, no forecast or
  trade call); others 0.07–0.27. Probes 4/4 demo fills with prices.
- Corrected my own earlier statement that Phase 4 "needs ≥ 3 months": that is
  §6's figure for an LLM-using strategy. Human asked to shorten; PHASE4-PREREG
  Amendment 3 fixes the window at 30 days, **ending 2026-10-25 17:05Z**, before
  any analysis of the notes. REPORT §12 and AGENTS updated.

## 2026-09-28 (b) — D4 shadow paper trading; a data-venue splice caught and reverted

- **Human decision: D4** — paper-trade the nine non-BTC universe pairs in
  parallel for statistical power (~70 vs 10–25 trades/yr). Logged in SPEC §7.5
  and the REPORT §11 register (five deviations; D3 had been declared final —
  this says so). `docs/SHADOW-PREREG.md` written before the first tick: same
  config (N unchanged at 34), 10,000 USDC per pair, independent accounts,
  verdict once at 100 pooled round trips or 2028-03-28, re-costed at observed
  p90 spreads as a pre-registered sensitivity. Pairs outside the universe only
  as tagged-exploratory amendments, never pooled.
- Build: `TradingLoopService.runOnce(symbol)`; decision/equity/risk/catch-up/
  stale rows now carry `symbol`. `ShadowLoopService` (:04) runs a second,
  non-provider instance of the same loop with a broker that journals
  `shadow-<kind>` and never mirrors — so every existing reader (status,
  analyst, uptime queries, calibrate-report, equity chart) excludes it by kind.
  `/api/journal` hides `shadow-*` unless asked; new `/api/shadow`; dashboard
  "Shadow pairs" card. Kill switch now sets the flag on ALL paper accounts;
  shadow accounts flatten on their own next tick (≤ 1 h). Deployed 12:16Z with
  `ENABLE_SHADOW_LOOP: "true"` in the compose file.
- **Incident (mine), found and reverted before anything consumed it:** bringing
  the nine pairs' candles current with `backfill-universe` from the host wrote
  **4,320 Kraken 1h candles** (08-29 → 09-28) onto the Bybit history of ETH,
  XRP, SOL, ADA, DOGE, AVAX — the host has no `DATA_EXCHANGE=bybit` and
  `createExchange` defaulted to `'kraken'`; `backfill-universe` read
  `uni.dataVenue` for its purge check but never passed it to the fetcher.
  ARB/SUI/MNT failing ("not listed on kraken") exposed it. Deleted exactly
  those rows in one transaction (count asserted), re-backfilled from Bybit: all
  ten pairs 1,140 Bybit candles 08-12 → 09-28 11:00, no gaps, zero Kraken rows
  since 08-12. BTC was never touched. Root fix: default venue `bybit`;
  `backfill(symbol, since, exchangeId?)`; the universe CLI passes its venue.
- **First shadow tick 2026-09-28 13:04Z — the D4 population starts here.**
  Nine accounts created (10,000 USDC each), nine `shadow-decision` rows (all
  hold), zero errors; every account started at the 12:00Z candle (no replay).
  BTC's 13:02 rows carry `symbol`, equity unchanged; zero non-BTC rows in
  regular kinds; analyst made no calls on shadow data.

## 2026-09-28 (c) — Dashboard: all-pairs trades and per-pair distance to entry

- New `/api/trades` (BTC `fill` + `shadow-fill`, newest first); `/api/shadow`
  accounts now carry `toEntryPct` / `toExitPct` from the same channel helper as
  BTC. Dashboard: "Shadow pairs" moved above Equity and sorted open-first then
  closest-to-entry, with a "To entry" column; new "Trades — all pairs" card.
  Agent redeployed 15:09Z (between ticks). At that time all nine flat; ETH
  closest to entry (5.29%), ARB furthest (26.6%).
- Added `/api/shadow-equity` (nine shadow accounts summed per candle; hours
  where any account is missing are dropped, so a gap never reads as a loss)
  and a "Shadow pairs — combined equity" chart under the BTC one. One pooled
  line by design — the verdict is pooled; per-pair lines invite cherry-picking.
  Redeployed 15:13Z. 3 points so far, flat at 90,000.

## 2026-10-24 — Kill-switch drill #3 (found in the journal 2026-11-09; not logged at the time)

- ON 18:48:21Z (#31461) → `analyst-paused` 18:50 (#31462) → 19:02 BTC tick
  halted (no decision row) → OFF 19:03:21Z (#31463) → `analyst-resumed` 19:05
  (#31482) → 20:02 `catch-up` missed 2, 18:00Z decided `replayed: true`, 19:00Z
  live. All ten accounts flat; equity unchanged 10,098.19. PASSED on the same
  checks as drill #2, plus the analyst's pause/resume markers (Amendment 1
  item 5) exercised live for the first time.
- **Not exercised:** the shadow-account halt/flatten path. OFF landed before
  the 19:04 shadow tick, which ran normally (9 decisions). Next drill (~11-24)
  should span a :04 tick — but only while all ten accounts are flat, so a drill
  never injects a `kill-switch flatten` exit into the D4 verdict population.

## 2026-11-09 — REPORT §13 written; analyst switched off

- Health: 48/48 BTC ticks and 432/432 shadow ticks in 48 h, no risk/error
  rows. BTC flat at 10,098.19 (+0.98% since 08-07; 6 real round trips, 2 won).
  Shadow: 8 round trips, 0 won, −280.95 on 90,000 while the nine pairs fell
  20–35% — interim, not a result, nothing changed because of it.
- **REPORT §13** written from the 30 rows inside the Phase 4 window (Amendment
  3): 26/30 daily notes (four missed, each in an overnight host-sleep gap),
  4/4 fill reviews, one prompt version, $1.31 total, zero errors, N 34. Jev
  guardrail reported as-is: `predictsPrice` ≥ 0.5 on 9 rows (forward-leaning
  structure language, no levels), the other two never ≥ 0.5. Commentary shown
  next to +7 d closes, unscored. The reviews caught that stop-fill `pnlNet`
  omits the entry fee (reporting convention; cash is correct).
- Analyst OFF: `ENABLE_LLM_ANALYST: "false"` in `docker-compose.local.yml`
  (overrides `.env`, which was not opened). Agent recreated 20:46Z, between
  ticks; env verified `false` in the container, status healthy. 14 calls
  ($0.54) ran after the window, outside §13's population.
- `HEALTHCHECK_PING_URL` still unset: it needs an external dead-man's check
  URL from the human.

## 2026-11-09 (b) — The overnight outages are SHUTDOWNS, not sleep

- macOS `pmset` on AC has `sleep 0`: idle sleep is already off. Every live-tick
  gap since wtmp began (2026-09-30) matches a shutdown/reboot pair in `last`:
  10-01 (12 h), 10-04 (11 h), 10-06→07 (shutdown 22:17 CEST, reboot 08:24),
  10-12→13 (22:27 → 08:43), 11-07 (shutdown 00:20 → reboot 18:56, 19 h). The
  agent came back by itself each time (Docker + `unless-stopped`) and replayed
  the missed candles. The Aug/Sep gaps predate the logs and stay "host down,
  cause unverified".
- So `caffeinate`/pmset changes would fix nothing. Options are human ones:
  leave the Mac on overnight, or run the stack on the always-on host SPEC §8
  already specifies (`docker-compose.prod.yml` exists). The dead-man ping
  (`HEALTHCHECK_PING_URL`) still only alerts; it does not prevent gaps.
