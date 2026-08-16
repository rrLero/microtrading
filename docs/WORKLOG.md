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
