# Work Log

Running history of operational and engineering work, for humans and AI agents.
Newest entries at the top. Keep entries short; link journal ids where useful.
(Entries before 2026-08-07 predate this log: Phases 0-2 were built per
SPECIFICATION.md — scaffold, ingestion/backfill 2019→now, §7 tooling,
backtester, three pre-registered strategy families evaluated, risk engine,
paper broker, trading loop, dashboard, watchdogs, ntfy alerts.)

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
  §6.3 comparison may be unable to validate slippage at all. See status snapshot.

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
- **Decision needed before the gate can mean anything**: the first real pairs
  suggest Bybit demo fills at last price (zero slippage) and on its own fee
  tier, so §6.3 as written may measure venue difference rather than fill-model
  error. Options: (a) calibrate slippage against Kraken's live order book
  half-spread instead (read-only, no orders, matches §6.2's actual formula),
  (b) compare fee-adjusted slippage only, (c) amend §6.3. Not actioned —
  human's call; §6.3 is unamended so far.
- Next phase gate: Phase 4 (LLM analyst) only after §6.3 calibration passes.
