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

## Operational state (as of 2026-08-24 — update when it changes)

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
    we measure, not what we hold. **§5.4 is a "V2 preview (not built now)" and
    §5.3 pins V1 to "max 1 open position (BTC only)" — concurrent positions are
    OUT OF V1 SCOPE, not a pending task.**
- Current evidence (dev, pooled, 0.10%), **all three families re-run at the
  current basis 2026-08-24**:
  - `sma-crossover` **11/12** clear the kill line; best {fast 10, slow 200,
    trendSma4h 30} PF 1.99, 497 raw / **144 effective** trades, DSR 0.87.
  - `donchian-breakout` 6/6 clear; best {55,20} PF 2.37, 215 raw / 59 effective,
    DSR 0.82.
  - `rsi-reversion` **0/16** clear; best PF 0.74, Sharpe −0.78, 599 raw / 214
    effective — a well-powered NEGATIVE result. This family is dead.
- **§7.4's evidence floor is "100 trades of concatenated OOS + paper" — READ THE
  SPEC TEXT, not a summary.** Donchian's 215 walk-forward OOS trades already met
  it. The "59 effective" deflation is a TOOL-side addition that is NOT in the
  spec; it was recorded here for weeks as though it were the requirement and it
  silently blocked the project. Either log it as deviation D4 or drop it.
- §7.4's kill criteria do NOT fire on donchian or sma-crossover. Dev DSR is NOT
  a gate: §7.4 wants DSR >0 at 95% confidence **on the holdout**, and that clause
  belongs to the *gate to live pilot*, which V1 does not pursue (§1.2 non-goal).
- Still not certifiable: best Sharpe 0.89 is below its minimum detectable 1.04.
  The null is bounded, not absolute. See `docs/REPORT.md`.
- **§7.2 regime reporting exists as of 2026-08-24** (`packages/core/src/regime.ts`,
  printed by `run-universe`). Both surviving families PASS the long-only bear
  test (donchian 10.3% bear exposure, sma-crossover 16.2% — they stand aside).
  **But BOTH are carried by 2024 and BOTH are net negative in 2025**: donchian
  2024 +76.0% / 2025 −2.4% (PF 0.88); sma-crossover 2024 +96.9% / 2025 −10.6%
  (PF 0.70). The advertised aggregate PF ~2 is substantially one calendar year.
  **DO NOT take either family to the holdout.** Monthly granularity (added
  2026-08-24) shows the result is essentially ONE MONTH: excluding 2024-11,
  donchian returns +24.1% instead of +104.0% (77% of the result is that month)
  and sma-crossover +25.0% instead of +120.9% (79%). Three years of pooled
  10-pair walk-forward OOS then yields ~8-9%/yr with 36-48% of months negative.
  §7.4's "3 consecutive months net negative" also fires for both (donchian to
  2024-06, sma to 2024-08) — but that is incidental: a 3-month run over 25-37
  months is unremarkable. The CONCENTRATION is the evidence.
  `run-universe` now prints all of this automatically.
- **SPEC IS FROZEN.** D3 was declared the final amendment before the holdout.
  Do not widen scope again; if results disappoint, §7.4's stopping rule applies.
- Holdout remains SEALED. Do not evaluate it without an explicit human decision.
- Kill-switch drill completed 2026-08-09/10 (flatten, halt, resume all verified).
  Next drill due ~2026-09-09.
- §6.3 gate is stated BY COMPONENT, not as one aggregate (`calibrate-report`):
  fees vs the published schedule (PASS), slippage vs the sampled book (**FAIL as
  of 2026-08-24** — was PASS through 08-20), mechanics via demo (PASS),
  fill-model-vs-venue NOT EVALUABLE.
  Pairs computed at a superseded cost basis are excluded automatically.
- Bybit demo fills at last price with ZERO spread and charges ~0.05% where live
  publishes 0.10% — it can validate order mechanics ONLY, not fees or slippage.
  Verified 2026-08-11 at 1k and 10k USDC. Don't try again.
- Slippage evidence comes from **hourly Bybit half-spread sampling across all 10
  universe pairs** (:07, read-only, `ops/spread-sample`). **As of 2026-08-24,
  n=2283: median 0.0137%, p90 0.0324%, max 0.1807% — p90 is now ABOVE the 0.03%
  model, so §6.3 axis 2 FAILS.** It passed at every prior reading; the flip is
  real, not a rounding wobble. **278 samples (12.2%) exceed the floor**, now on
  seven pairs: AVAX (71/226, p90 0.0340%), ADA (70/226, p90 0.0553%), ARB
  (66/226, p90 0.0487%, max 0.1807%), SUI (31/226), DOGE (30/226), SOL (8/226),
  XRP (2/226). Clean: BTC, ETH, MNT.
  **A liquidity regime changed on 2026-08-21**: daily breach rate went ~5% (08-13
  → 08-18) to 24%/35%/27%/22% (08-21 → 08-24). Not a price artifact — those pairs
  RALLIED 18–30% over the same window, which shrinks a fixed tick as a percentage,
  so the books genuinely widened against that tailwind. DOGE went 0% → 42.9%
  breaches, SUI 1.3% → 41.4%. **The restart confound was tested and CLEARED on
  2026-08-24**: an independent host-side read (raw Bybit v5 REST, no ccxt, no
  container) against the container's :07 sample gave 5 exact matches out of 10,
  with the rest split symmetrically (2 pairs host-higher at 2.00×, 3 host-lower
  at ~0.60×) — tick-quantisation jumps over the 19-minute gap, not systematic
  inflation. The sampler reads the same book the host does; the deterioration
  is real market structure. Do not re-litigate this.
  BTC/USDC — the only pair actually traded — still has ZERO breaches (n=249,
  max 0.0074%), so the live paper loop's fill model remains pessimistic. The
  breaches bite the pooled 10-pair evaluation, where the model is now optimistic
  ~12% of the time. The dashboard meter turns red on the sample that breaches.
  Re-read these numbers from `calibrate-report` before quoting them; they have
  gone stale three times.
- Daily calibration probe: cron 13:37 UTC, `ENABLE_CALIBRATION_PROBE`. One ~1000
  USDC demo round trip/day, isolated from paper_account, skips on kill switch.
- Do NOT run `pnpm build` **or `pnpm test`** (repo root) while the dashboard dev
  server is up — turbo pulls `dashboard:build` into the test task too, they share
  `.next`, and the dev server then serves 500s (hit again 2026-08-20). Recovery:
  stop dev, `rm -rf apps/dashboard/.next`, restart dev. To test the agent safely
  while dev is up, scope it: `pnpm --filter @microtrading/core test`.
  See `apps/dashboard/README.md`.
- Repo is under git as of 2026-08-11. Commit before soak-affecting changes.

## Safety rules for agents

- NEVER read, print, or commit `apps/agent/.env` / `.env.prod` (exchange keys).
- Never place live-exchange orders. Demo endpoint only (api-demo.bybit.com).
- Do not modify pre-registered grids, holdout tooling, or §7 enforcement code
  without the human explicitly deciding to amend the spec.
- Two trading loops must never run at once (terminal + Docker): before starting
  one, confirm the other is stopped.
