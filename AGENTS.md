# MicroTrading — Guide for AI Agents

AI-assisted micro trading agent. **Paper trading only in V1 — no real money.**
This file is the canonical context for any AI coding agent working in this repo
(Claude Code reads it via CLAUDE.md; other tools read it directly).

## Binding documents — read before non-trivial work

- `SPECIFICATION.md` (v0.3) — the contract. **§7 (evaluation protocol) is the
  project's constitution and is frozen.** §6.2 fill model, §6.3 calibration
  gate, §5 risk rules, §4.1.4 kill switch.
- `REVIEW.md` — why the rules exist. Read it before proposing rule changes.
- `experiments/*.json` — PRE-REGISTERED parameter grids. Never edit an existing
  grid; never run holdout evaluation casually (§7.2: the holdout burns once).

## Architecture (one-code-path constraint, SPEC §4.1)

```
packages/core     pure domain: types, indicators, candle utils, strategies,
                  backtest engine. NO framework imports — the backtester
                  replays the exact same code the live loop runs.
apps/agent        NestJS: ingestion (Kraken 1h→derived 4h), Postgres via
                  Drizzle, risk engine, PaperBrokerService (§6.2 pessimistic
                  fills), TradingLoopService (hourly tick at :02, closed
                  candles only), BybitDemoMirrorService (§6.3), read-only
                  ops API on :3001, CLIs in src/cli/.
apps/dashboard    Next.js (port 3002), read-only, proxies /agent/* → :3001/api/*.
```

## Invariants that are easy to violate

- Decisions fire on **closed candles only**; fills at next candle's open.
- All timestamps are UTC epoch ms. Warsaw time is display-only.
- The 4h series is derived locally from 1h; never store a forming candle.
- `packages/core` stays framework-free.
- The journal is **append-only** — corrections are new entries, never updates.
- Trial budget: ≤20 configs per strategy family, pre-registered before any
  backtest. Every report must print N (total trials) or it is invalid.
- The kill switch (`pnpm kill-switch -- on`) flattens and halts; it is a DB
  flag, so the CLI on the host controls the Docker agent. Drill monthly.
- Bybit demo mirroring must NEVER be able to break the paper loop (all mirror
  errors are caught and journaled as ops/mirror-error).

## Commands (repo root)

```bash
pnpm build                                      # turbo: core → agent → dashboard
pnpm test                                       # core unit tests
pnpm --filter @microtrading/agent demo-ping     # verify Bybit demo keys (read-only)
pnpm --filter @microtrading/agent kill-switch -- on|off
pnpm --filter @microtrading/agent calibrate-report   # §6.3 modeled-vs-real costs
docker compose -f docker-compose.local.yml up -d --build   # prod-like local stack
docker compose -f docker-compose.local.yml exec db psql -U micro -d microtrading
curl -s localhost:3001/api/status | jq          # agent health (also /api/journal, /api/equity)
```

Typecheck without emitting: `cd apps/agent && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`.

## Work history

See `docs/WORKLOG.md` for the running log of what has been done and why.
Update it after every significant operational or engineering change.

## Operational state (as of 2026-08-11 — update when it changes)

- Agent runs in Docker on this Mac (`docker-compose.local.yml`, same compose
  project + `pgdata` volume as dev compose → data is shared with host tooling
  on port 55432). Dashboard runs separately via `pnpm --filter @microtrading/dashboard dev`.
- Phase 3 soak in progress: strategy `donchian-breakout(40,10)` on BTC/USDC 4h,
  paper account started 2026-08-07 with 10,000 USDC.
- Kill-switch drill completed 2026-08-09/10 (flatten verified, halt verified,
  resume verified). Position currently flat post-drill.
- §6.3 Bybit demo mirror is ARMED and, since 2026-08-11, actually captures
  fill prices — the read-back was broken before then (see WORKLOG 08-11).
- Daily calibration probe: BUILT and armed (cron 13:37 UTC,
  `ENABLE_CALIBRATION_PROBE` in docker-compose.local.yml). One ~1000 USDC
  demo buy→sell round trip/day → 2 §6.3 pairs/day. Isolated from
  paper_account, skips when the kill switch is on. Run one now with
  `pnpm --filter @microtrading/agent calibration-probe`.
- OPEN: probe pairs show zero demo slippage and a Bybit-vs-Kraken fee-tier gap,
  so §6.3 may currently measure venue difference, not fill-model error.
  Decision pending — see the WORKLOG status snapshot before touching the gate.

## Safety rules for agents

- NEVER read, print, or commit `apps/agent/.env` / `.env.prod` (exchange keys).
- Never place live-exchange orders. Demo endpoint only (api-demo.bybit.com).
- Do not modify pre-registered grids, holdout tooling, or §7 enforcement code
  without the human explicitly deciding to amend the spec.
- Two trading loops must never run at once (terminal + Docker): before starting
  one, confirm the other is stopped.
