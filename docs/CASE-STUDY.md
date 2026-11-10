# Two honest nulls: what a disciplined trading research setup found

*A case study of MicroTrading, a crypto trading agent built during 2026 with an AI coding assistant. The figures come from
[`REPORT.md`](REPORT.md), which cites the database row behind each one.*

## The problem with trading backtests

A backtest is a search. Try enough parameter combinations on enough history and one
of them will look brilliant by chance. The usual defences are well known: pre-register,
count your trials, keep a holdout you never touch, and model costs pessimistically.
They are also usually skipped, because the researcher and the person who wants the
strategy to work are the same person.

MicroTrading's premise is that these defences only work if **the tooling enforces
them**. The registration CLI refuses a second registration. The budget check refuses
the 46th config. The holdout tool refuses to run twice. The verdict script is
committed before the data it judges exists.

## Study 1: trend-following looked good, and was one month

**Hypothesis.** Simple trend rules on 4-hour crypto bars beat costs. Three families
were tested: moving-average crossover, RSI reversion and Donchian breakout. That is
34 configurations, pre-registered, evaluated walk-forward and pooled across ten Bybit
pairs.

**What the aggregate said.** Donchian breakout had a profit factor of 2.37 over 215
out-of-sample trades, and MA crossover 1.99 over 497. Both cleared every development
gate.

**What the decomposition said.** The protocol prints monthly returns automatically.
**77% of Donchian's result is November 2024.** Excluding that month, the return falls
from +104% to +24% over three years: about 8% a year, with 36–48% of months negative.
Both families are net negative in 2025. A strategy whose evidence is one month has no
evidence.

**The costs story.** The project started with an assumed 0.26% fee. Verification
found the venue's real retail tier was 0.80%, and **at 0.80% no configuration of any
family survives**. Moving to a 0.10% venue was logged as a deviation, with the date it
was recognised, rather than quietly edited in. Hourly order-book sampling later caught
a liquidity regime change: on 7 of 10 pairs the slippage model went from pessimistic
to optimistic.

**Forward test.** Instead of spending the holdout on a result that the decomposition
had already undermined, the deployed rule ran forward on paper across all ten pairs.
After 10 round trips it has 0 wins. The verdict is pre-written and runs at 100 trades.

## Study 2: funding carry was real, and too small

**Hypothesis.** Holding spot BTC and shorting the same amount of perpetual futures is
price-neutral and collects funding, the payment leveraged longs make to shorts every
8 hours. This is a structural premium, not a forecast.

**Protocol.** Four configs (always on, plus three funding-gated entry rules) were
registered before any funding statistic was computed. Pass bar: more than 4% a year on
capital after fees and slippage on both legs, out of sample, roughly what low-risk
USDC yield pays.

| | Dev 2022-01 → 2025-07 | Holdout 2025-08 → 2026-07 |
|---|---|---|
| Best config (gated, chosen by rule) | 4.17%/yr | **1.00%/yr** |
| Always on | 2.67%/yr | 1.23%/yr |

Funding on the USDC perp roughly halved, and the gating rule that won on dev lost to
"always on" once the dev window ended. **FAIL**, on the project's one holdout
evaluation. A fresh reviewer then showed that the holdout's own funding data caps the
possible return at about 1.6% even with zero costs, so no accounting bug could have
turned the result.

**What averages hide.** On 2023-03-11, when USDC lost its peg after SVB, BTC priced in
USDC traded 11% above the USD-tracking perp, and the "neutral" position swung 8% and
back within 14 hours. A stablecoin-margined carry carries the stablecoin's risk.

## AI in the loop

Two roles, deliberately separated:

- **As the engineer's assistant:** an AI coding agent wrote most of the code under the
  project's rules. A stress test of the record found an unlogged post-hoc tightening
  that had silently blocked the project for weeks. A later check found that the
  journal understated losses by omitting entry fees. Both were corrected as new
  entries, never by rewriting history.
- **As an analyst in the product:** Claude wrote daily market commentary for 30 days
  (cost $1.31). It was observability only. It never placed orders, never fed a strategy,
  and its prompt was never tuned on results, because tuning prompts on results is
  multiple testing too.

## What carries over

1. **Decompose before you believe.** A profit factor of 2.37 meant nothing once the
   monthly breakdown was printed. Make the decomposition automatic.
2. **Verify costs at the source.** The single biggest swing in this project was a fee
   assumption.
3. **Write the verdict first.** Both final verdicts were code committed before the data
   existed. There was nothing left to argue about afterwards.
4. **A null is a result.** The pre-registered stopping rule says that when nothing
   passes, the deliverable is the infrastructure and the write-up. This is that.
