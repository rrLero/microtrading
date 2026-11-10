# V3: forward multi-coin funding carry, paper — design

**Status:** draft for approval, 2026-11-10. Nothing is built until the human approves.

## 1. Intent

V2 found that BTC funding on the USDC perp is real but too small: 1.00%/yr on capital
in the holdout. Funding on **USDT-settled altcoin perps** is the larger, more
crowded side of the market, and the structural reason for carry (leveraged longs pay
shorts) is strongest there. The owner wants to keep testing on paper, since no money
is at risk.

> **Question:** over the next 6 months, does a price-neutral carry (spot long + equal
> perp short, 1×) on the ten pre-registered universe coins, using USDT markets, earn
> more than 4%/yr on capital after every cost?

The holdout is spent (C4/D5), so this is a **forward-only** test, like D4. The rules
are fixed today, and the verdict comes from data that does not exist yet.

## 2. Goals, non-goals, anti-goals

**Goals**
1. Pre-register 2 configs now (N 38 → 40).
2. Run them forward on paper from a start date fixed in this document.
3. Show them on the dashboard as they run.
4. Evaluate once at the end date with a verdict script committed before the start.

**Non-goals**
- Real money; demo orders; a holdout run; backtesting these configs on history
  before the start.
- Changing V1, D4, the BTC loop or the V2 code paths.
- Coins outside `experiments/universe.json`.

**Anti-goals: it fails even if it "works" if any of these happen**
- Rules, coins, costs or the end date change after the start.
- An interim number is used to stop early, drop coins or re-weight.
- The headline is one coin's result. The verdict is pooled; per-coin figures are a
  breakdown only.

## 3. What runs

- **Coins:** the ten in `experiments/universe.json` (BTC, ETH, XRP, SOL, ADA, DOGE,
  ARB, SUI, MNT, AVAX). They were pre-registered on 2026-08-12, so no coin is
  chosen now. Bybit lists a USDT spot pair and a USDT linear perp for each.
  Funding is every 8 h as of 2026-11-10.
- **Position per coin:** an independent paper account of 10,000 USDT, set up as in V2.
  - Spot `X/USDT` long with C/2.
  - Equal-quantity `XUSDT` perp short with C/2 as margin (1×).
  - Rebalance (full close and reopen) when the perp mark reaches 1.5× the entry.
  - Pooled capital is 100,000 USDT per config.
- **Configs:**

  | id | rule |
  |---|---|
  | **K1** | always on, all ten coins |
  | **K2** | per coin: enter when the trailing 21-print funding APR > 10%, exit when < 0%. This is V2's C2 rule, tested on new instruments |

- **Costs:** spot taker 0.10%, perp taker 0.055%, 0.03% slippage per leg per side.
  These are the V2 basis, and the same for every coin.
- **Window:** **6 calendar months from the start.** The start is the first 00:00Z
  after the pre-registration row is written. The registration row stores `startTs`
  and `endTs`, and the verdict script reads them from there. After registration, no
  date can move. *(Builder-check: my call. Planned start is 2026-11-17 if the build
  lands by then; slipping moves both dates together, but only before registration.)*
  Nothing before the start counts. K2's trailing signal may warm up on earlier
  funding prints, which are past data, not results.
- **K2's lookback is time-based:** the mean of the funding prints in the trailing
  **7 days**, not "21 prints". If Bybit shortens a coin's interval, the rule keeps
  its speed. *(Builder-check: my call. It equals 21 prints at 8 h.)*
- **Broken data, decided now:**
  - Bars missing either leg are skipped and counted, as in V2.
  - Hours missed during an agent outage are backfilled from Bybit's public history
    and count. The data is public and deterministic, so backfilling chooses nothing.
  - If a coin's spot pair or perp is delisted or suspended, its position closes at
    the last bar where both legs exist, with full costs. The account then holds
    cash for the rest of the window and stays in the pooled 100,000.

  *(Builder-check: my call.)*

## 4. How it runs: a forward backtest, not a live loop

Carry outcomes are fully determined by public candles and funding prints. The
paper loop models fills from candles too. So the honest and simplest
implementation is:

- **Hourly ingestion** of 1h candles and funding prints for the 20 symbols (10 spot,
  10 perp), from the start onwards, into the existing `candles` and `funding_rates`
  tables. It runs at :09, after the existing ticks, to stay clear of :02/:04/:07.
- **Hourly snapshot:** run `runCarry` (the same core code as V2) per coin per config
  over [start, now). Journal one `carry-forward` row with per-coin and pooled
  equity, funding, costs and position state. The engine is deterministic, so a
  snapshot never changes past results.
- **Dashboard:** a carry card showing K1 and K2 pooled equity, net APR so far,
  funding vs costs, coins in market, and "INTERIM — not the verdict".
- **Verdict CLI** (`v3-carry-verdict`): committed before the start. At or after the end
  date it recomputes from stored data and prints PASS/FAIL per criterion.

## 5. Verdict: evaluated once at 2027-05-17, per config, pooled over ten coins

All must hold for a config to PASS:
1. Pooled net APR on 100,000 > **4%**.
2. Best month < 50% of net.
3. Pooled max drawdown < 5%.
4. K2 only: its net APR > K1's.

Both configs are reported. There is no selection between them afterwards.

**Interpretation is fixed now:**
- A PASS supports building toward a regulated EU perp venue (V2 design §9).
- A FAIL closes funding carry for this project.

## 6. Engine change required (core)

`trailingApr` uses a print count and × 1095, which assumes 8 h prints. Bybit can
change a coin's funding interval (to 4 h or 1 h) during volatility. V3 adds a
time-window variant: the mean of the prints in the last 7 days, annualised by their
median spacing (`mean rate × 365 d / median interval`). The V2 function and V2
results are unchanged. The variant needs tests for 8 h, mixed 8 h/1 h, and
"no prints in window → null".

## 7. Constraints

- `packages/core` stays framework-free; V2 tests keep passing.
- Journal append-only. `carry-forward` rows are snapshots, never edited.
- Ingestion failures for one symbol never stop the others or the trading loops.
- The kill switch does not need to halt this. Nothing trades, and there is no
  order path.
- Pre-registration is a SPEC §7.5 **D6** entry (human decision; the builder drafts
  it from this document) plus `experiments/funding-carry-v3.json`. Registration
  writes the preregistration row **and the 2 trial rows at once**, so N = 40 from
  that moment. The configs are fixed at registration, so counting them then is the
  conservative choice. `preregister-carry` is generalised to take the grid file and
  family name. *(Builder-check: my call.)*
- The perp fee of 0.055% is Bybit's published non-VIP taker rate for USDT and USDC
  perps (help centre, read 2026-11-10).

## 8. Left to the builder

Table/payload field names, card layout, the snapshot cadence if hourly is too
heavy (daily is acceptable), and how per-coin breakdowns are displayed.
