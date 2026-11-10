# MicroTrading

**A crypto trading research harness built to stop you from fooling yourself.**

It pre-registers every hypothesis, budgets the number of trials, seals one holdout,
and re-measures costs from the live order book. It runs the backtest and the paper loop
through the exact same code, and writes every decision to an append-only journal. It
has been used to test two strategy ideas end to end. **Both came back null, and the
harness is why we know that instead of believing a backtest.**

> Paper trading only. Nothing here is investment advice or a claim that any strategy
> makes money. The point is the opposite.

## What it found

| Study | Looked like | Actually was |
|---|---|---|
| **V1: trend-following** on 4h bars across 10 Bybit pairs (3 families, 34 configs) | Profit factor 2.37, +104% over the walk-forward test | 77% of the result is **one month** (2024-11). Without it: ~8%/yr with 36–48% losing months. Forward paper on 10 pairs: 0 wins in 10 trades. |
| **V2: funding-rate carry**: BTC spot long + perp short, price-neutral | 4.17%/yr on dev (2022–2025), above the 4% bar | **1.00%/yr on the sealed holdout** (2025-08 → 2026-07). Funding halved; the timing rule lost to "always on". |

There were also findings that no headline number shows:
- The fee assumed at the start (0.26%) was wrong. The venue's real tier was 0.80%,
  where nothing survives; moving to a 0.10% venue is logged as a deviation, not
  quietly applied.
- Sampled spreads breached the slippage model on 7 of 10 pairs after a liquidity
  regime change, so the model is now known to be optimistic on those pairs about 12% of the time.
- On the SVB weekend (2023-03-11), USDC lost its peg. The spot and perp legs of a
  "price-neutral" carry moved 11% apart within hours.
- An LLM analyst (Claude) ran for 30 days for $1.31, as observability only. It never
  placed an order or fed a strategy, so it added no trials.

Full write-up: [`docs/CASE-STUDY.md`](docs/CASE-STUDY.md). Every number, with row ids:
[`docs/REPORT.md`](docs/REPORT.md).

## The discipline, enforced by code, not good intentions

| Rule | Where it's enforced |
|---|---|
| Hypotheses and parameter grids are committed **before** any backtest; registrations are immutable | `experiments/*.json`, `preregister`, `preregister-carry` |
| Total trial budget across all ideas (≤ 45); every report prints N | `MAX_TOTAL_CONFIGS`, `countDistinctConfigsAllFamilies` |
| One holdout, evaluated **once**, across all families. Now spent; the tools refuse a second run | `run-holdout`, `carry-verdict`, `assertHoldoutUnspent` |
| Verdict scripts are written and committed before the data they judge exists | `shadow-verdict`, `carry-verdict` |
| Backtest and paper loop share one code path; the domain core imports no framework | `packages/core` |
| Costs are pessimistic and re-measured: hourly order-book spread sampling, daily demo-venue probe | `calibrate-report` |
| Every decision, fill and model output goes to an append-only journal; corrections are new rows | `journal` table |
| Deviations from the plan are logged with *when* they were recognised | `SPECIFICATION.md` §7.5 |
| Kill switch flattens and halts every account; drilled monthly | `kill-switch` |

## Stack

pnpm + Turborepo, TypeScript strict, Node 22.

```
packages/core   pure domain: indicators, strategies, backtest engine, carry engine,
                round-trip P&L, verdict statistics. No framework imports.
apps/agent      NestJS: Bybit ingestion (ccxt), Postgres via Drizzle, risk engine,
                pessimistic paper broker, hourly trading loop, shadow accounts,
                ops API on :3001, research CLIs in src/cli/.
apps/dashboard  Next.js (:3002), read-only.
```

## Quickstart

```bash
pnpm install
docker compose -f docker-compose.local.yml up -d db
cp apps/agent/.env.example apps/agent/.env        # no keys needed for research
pnpm build
pnpm --filter @microtrading/agent db:push
pnpm --filter @microtrading/core test

pnpm --filter @microtrading/agent backfill-universe   # 10 pairs, 1h, from Bybit
pnpm --filter @microtrading/agent run-universe -- donchian-breakout
pnpm --filter @microtrading/agent backfill-carry      # BTC perp candles + funding history
```

A new idea starts with a grid file in `experiments/`, a deviation entry in
`SPECIFICATION.md` §7.5, and a commit. The backtest comes after that.

## Read next

- `SPECIFICATION.md`: the contract. §7 is the evaluation protocol.
- `REVIEW.md`: why each rule exists.
- `docs/REPORT.md`: the evaluation report, written to Arnott, Harvey & Markowitz (2019).
- `docs/WORKLOG.md`: the dated log of every decision.
- `AGENTS.md`: operating guide for AI coding agents working in the repo.
