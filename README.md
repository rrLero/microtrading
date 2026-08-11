# MicroTrading

AI-assisted micro trading agent. **Paper trading only in V1 — no real money.**
Read `SPECIFICATION.md` (v0.3) first; `REVIEW.md` explains why the rules exist.
Section 7 of the spec (evaluation protocol) is binding for all backtesting work.

## Stack

pnpm + Turborepo monorepo · TypeScript strict, Node 22 · NestJS agent ·
Drizzle ORM + Postgres (Docker) · ccxt (REST + WebSocket) · Next.js dashboard (Phase 3).

```
packages/core   — pure domain: types, indicators, candle utils, adapter interfaces.
                  NO framework imports allowed here (one-code-path constraint, SPEC §4.1).
apps/agent      — NestJS service: config, DB, ingestion (Phase 0); risk/execution (Phase 2).
apps/dashboard  — Next.js, arrives in Phase 3.
```

## Phase 0 — getting started

```bash
pnpm install
docker compose up -d          # Postgres 16 on :5432
cp apps/agent/.env.example apps/agent/.env
pnpm build                    # turbo: core → agent
pnpm --filter @microtrading/agent db:push   # create tables (drizzle-kit)
pnpm test                     # core unit tests (indicators, candle utils)
pnpm backfill                 # REST backfill BTC/USDC 1h candles
```

### Historical data — important Kraken limitation

Kraken's REST OHLC endpoint returns only the most recent **~720 candles** per
timeframe (~30 days of 1h). For the 2019→now window required by SPEC §2.4:

1. Download Kraken's OHLCVT archives (60-minute files) from
   [their historical data page](https://support.kraken.com/articles/360047124832),
2. `pnpm import-csv -- path/to/XBTUSDC_60.csv` (repeat per file/quarter),
3. `pnpm backfill` then tops up from the last imported candle to now.

Both commands are idempotent (upsert on `(symbol, timeframe, ts)`) — re-run freely.
The backfill prints a data-quality report (gaps, OHLC inconsistencies) at the end;
do not backtest on a series with unexplained gaps.

If BTC/USDC CSV history proves too shallow on Kraken, fallback discussed in spec:
ingest BTC/USDT history for *backtesting* (deep everywhere) while trading USDC
live — note the quote-asset basis difference in the experiment log.

## Phase 0 open verification items (need your accounts)

- [ ] Actual Kraken fee tier for your account (spec assumes entry tier)
- [ ] BTC/USDC order-book depth on Kraken at micro size
- [ ] Bybit EU account → demo trading API keys availability

## Rules that are easy to forget while coding

- Decisions fire on **closed candles only**; orders fill at next candle's open (SPEC §3).
- All timestamps UTC epoch ms. Warsaw time is for humans only.
- Never store a forming candle; the 4h series is derived from 1h locally.
- `packages/core` stays framework-free — the backtester replays it in a tight loop.
- No backtest without a pre-registration row in the experiments table (SPEC §7.1).
