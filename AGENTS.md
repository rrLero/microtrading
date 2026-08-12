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

## Operational state (as of 2026-08-12 — update when it changes)

- Agent runs in Docker on this Mac (`docker-compose.local.yml`, same compose
  project + `pgdata` volume as dev compose → data is shared with host tooling
  on port 55432). Dashboard runs separately via `pnpm --filter @microtrading/dashboard dev`.
- Phase 3 soak in progress: strategy `donchian-breakout(40,10)` on BTC/USDC 4h,
  paper account started 2026-08-07 with 10,000 USDC. Position flat.
- **VENUE + COSTS + UNIVERSE all changed 2026-08-12** (SPEC §7.5 D1/D2/D3 — read
  them before touching anything cost-related):
  - **Bybit is now BOTH the data and execution venue.** Kraken is no longer used
    for either. Its OHLC API caps at ~720 bars, and evaluating on one venue while
    filling on another injected a basis error (measured: median 0.019%, max
    0.201% over 2,160 matched bars).
  - Taker fee is **0.10%** (Bybit EU non-VIP, published). It was an unverified
    0.26% from Phase 0 until 2026-08-12; Kraken's real Level 1 is 0.80%, at which
    NO configuration of any family survives.
  - Evaluation runs **pooled over a 10-pair universe** (`experiments/universe.json`,
    pre-registered, immutable — pooled is the verdict, never per-pair selection).
    **Trading is still ONE open position on BTC/USDC**; the universe widened what
    we measure, not what we hold. Concurrent positions need §5.4 first.
- Current evidence (dev, pooled, 0.10%): 6/6 configs clear the §7.4 kill line,
  best {55,20} PF 2.37 — but **59 effective trades of 100 required** and
  **DSR 0.82 of 0.95**. Minimum detectable Sharpe is 1.04 against an observed
  0.85, so the null is bounded, not absolute. NOT a pass. See `docs/REPORT.md`.
- **SPEC IS FROZEN.** D3 was declared the final amendment before the holdout.
  Do not widen scope again; if results disappoint, §7.4's stopping rule applies.
- Holdout remains SEALED. Do not evaluate it without an explicit human decision.
- Kill-switch drill completed 2026-08-09/10 (flatten, halt, resume all verified).
  Next drill due ~2026-09-09.
- §6.3 gate is stated BY COMPONENT, not as one aggregate (`calibrate-report`):
  fees vs the published schedule (PASS), slippage vs the sampled book (PASS,
  provisional), mechanics via demo (PASS), fill-model-vs-venue NOT EVALUABLE.
  Pairs computed at a superseded cost basis are excluded automatically.
- Bybit demo fills at last price with ZERO spread and charges ~0.05% where live
  publishes 0.10% — it can validate order mechanics ONLY, not fees or slippage.
  Verified 2026-08-11 at 1k and 10k USDC. Don't try again.
- Slippage evidence comes from **hourly Bybit half-spread sampling across all 10
  universe pairs** (:07, read-only, `ops/spread-sample`). All under the 0.03%
  floor; worst is ADA/USDC at ~90% of it — a breach flips the model from
  pessimistic to optimistic, and the dashboard meter turns red if it happens.
- Daily calibration probe: cron 13:37 UTC, `ENABLE_CALIBRATION_PROBE`. One ~1000
  USDC demo round trip/day, isolated from paper_account, skips on kill switch.
- Do NOT run `pnpm build` (repo root) while the dashboard dev server is up —
  they share `.next` and it serves 500s. See `apps/dashboard/README.md`.
- Repo is under git as of 2026-08-11. Commit before soak-affecting changes.

## Safety rules for agents

- NEVER read, print, or commit `apps/agent/.env` / `.env.prod` (exchange keys).
- Never place live-exchange orders. Demo endpoint only (api-demo.bybit.com).
- Do not modify pre-registered grids, holdout tooling, or §7 enforcement code
  without the human explicitly deciding to amend the spec.
- Two trading loops must never run at once (terminal + Docker): before starting
  one, confirm the other is stopped.
