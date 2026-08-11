# Professional Review of SPECIFICATION.md v0.2

**Reviewer stance:** professional trader / quant risk reviewer, adversarial by design.
**Date:** 2026-08-02
**Verdict:** The spec is unusually honest for a retail project (paper-first, costs
modeled, LLM kept out of the order path). But it has **one internal contradiction,
one missing discipline that kills most retail quant projects (backtest protocol),
and several unpriced risks** that must be resolved before Phase 1. Questions are
numbered **Q-R1…Q-R12**; each cites the literature that motivates it.

---

## A. Findings against the spec's own math

### R1. §2.3 uses √-time volatility scaling — crypto violates its assumptions ⚠️ internal contradiction

√-time scaling assumes i.i.d., roughly normal returns. The empirical literature is
unambiguous that Bitcoin returns exhibit **fat tails, volatility clustering, and
multifractality** — GARCH-family models consistently beat constant-vol assumptions
(e.g. [Gyamerah 2019, arXiv](https://arxiv.org/pdf/1909.04903); [Takaishi 2021,
time-varying asymmetric volatility](https://pmc.ncbi.nlm.nih.gov/articles/PMC7850481/);
[MARMA-GARCH 2025](https://doi.org/10.3390/econometrics13020013); [double-subordinated
Lévy processes, Risks 2024](https://doi.org/10.3390/risks12050082)).

- The **fee conclusion survives** — fat tails make short-timeframe trading *worse*,
  so the error is in the safe direction.
- But the same scaling must **never be reused for risk sizing** (e.g. deriving
  stop distances or VaR from daily vol × √t). Realized vol comes in clusters:
  the calm-period estimate is exactly wrong when it matters.

**Q-R1:** Will position sizing and stop distances be driven by *current realized*
volatility (e.g. ATR/EWMA per candle) rather than any constant-vol assumption?
Spec should say so explicitly.

### R2. No backtest protocol — the single most likely failure mode

[Bailey, Borwein, López de Prado & Zhu, *Pseudo-Mathematics and Financial
Charlatanism*, Notices of the AMS 2014](https://www.ams.org/notices/201405/rnoti-p458.pdf)
show that after testing only **~10 strategy configurations**, you can expect to find
an in-sample Sharpe ratio of ~1.57 **from pure noise** (expected out-of-sample: zero),
and that with 5 years of data no more than ~45 independent configurations should be
tried at all. Their companion work formalizes the
[Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)
and the [Deflated Sharpe Ratio](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551)
as corrections.

The spec mentions overfitting in the glossary but Phase 1 has **no protocol**: no
train/validation/holdout split, no trial counting, no multiple-testing correction,
no walk-forward analysis.

**Q-R2:** Before Phase 1, define and freeze: (a) a **holdout period never touched
during development** (e.g. the most recent 6 months); (b) a **trial log** — every
parameter combination ever backtested gets recorded in the journal, so N is known;
(c) walk-forward evaluation rather than a single split; (d) success judged only on
holdout, ideally with a deflated-Sharpe sanity check. Who enforces this when the
only developer is also the only researcher?

### R3. No falsifiable stopping rule — the base rates demand one

[Barber, Lee, Liu & Odean, *Do Individual Day Traders Make Money?* (Taiwan, complete
market data)](https://faculty.haas.berkeley.edu/odean/papers/Day%20Traders/Day%20Trade%20040330.pdf)
found **more than 8 out of 10 day traders lose money net of costs** in a typical
six-month period; only a small group shows persistent skill. The spec honestly says
"most retail algo strategies lose money" — but honesty without a decision rule is
just a disclaimer.

**Q-R3:** Define now, in writing: (a) the minimum number of trades before any
conclusion is drawn (a 2-week paper run on 1h candles might produce <20 trades —
statistically meaningless); (b) the concrete result that triggers "stop / redesign"
vs "proceed"; (c) the metric set (net return, max drawdown, profit factor, Sharpe,
exposure time) computed identically in backtest and paper.

---

## B. Risk-management gaps

### R4. Stop-losses are treated as a guarantee — they are not

A stop-loss is an *intention*, not a contract. In a fast market or gap, a stop-market
order fills at the next available price (potentially far below the stop); a
stop-limit may not fill at all. Crypto's documented
[extreme activity episodes](https://www.sciencedirect.com/science/article/abs/pii/S1703494922000305)
make this a when-not-if event on a 24/7 venue.

**Q-R4:** (a) Stop-market or stop-limit, and why? (b) What does the risk engine do
when the fill price is materially worse than the stop (recompute daily-loss state
immediately?)? (c) The −3% daily cutoff can be *jumped over* by one gap — is there a
hard max-position-size cap independent of stop distance? (d) Is the backtester's
fill model pessimistic on stops (fill at next candle's open, not at the stop price)?

### R5. Exchange counterparty risk is absent from the live gate

Funds on an exchange are an unsecured claim on that exchange — the
[FTX collapse literature](https://www.researchgate.net/publication/375588904_The_collapse_of_the_FTX_exchange_The_end_of_cryptocurrency's_age_of_innocence)
([systemic spillover evidence](https://www.sciencedirect.com/science/article/abs/pii/S1544612323004713))
is the canonical case. MiCA licensing reduces but does not eliminate insolvency risk.

**Q-R5:** For the (future) live phase, the gate in §6 should add: maximum % of
trading capital held on-exchange at any time, a periodic withdrawal ("sweep")
policy, and API keys created **withdrawal-disabled with IP allowlisting** — the
agent must be architecturally incapable of moving funds off-exchange.

### R6. Quote-currency risk: USDT is itself a position

The spec prices everything in USDT. Stablecoins carry documented
[devaluation/depeg risk](https://www.tandfonline.com/doi/full/10.1080/1351847X.2025.2505757)
and [stress-period fragility](https://arxiv.org/html/2607.08524v1). Holding "cash"
in USDT is a carry trade on Tether's solvency.

**Q-R6:** (a) Should V1 quote in EUR (Kraken offers BTC/EUR, ETH/EUR with deep books)
or USDC instead? (b) In what currency is P&L *reported* — a "flat" USDT P&L can be a
real EUR/PLN loss? (c) Tax treatment in Poland of crypto-crypto vs crypto-fiat trades —
verify with a tax advisor before live (not a Claude determination).

### R7. LLM features can inject look-ahead bias into backtests

A growing literature shows pretrained LLMs leak future knowledge into "historical"
analysis — the model already knows what happened after any past date
([Detecting Lookahead Bias in LLM Forecasts](https://arxiv.org/html/2512.23847v2);
[Lookahead Bias in Pretrained Language Models](https://www.researchgate.net/publication/379767258_Lookahead_Bias_in_Pretrained_Language_Models);
[DatedGPT](https://arxiv.org/html/2603.11838v2)). If LLM-generated features are ever
synthesized *for past dates* to enrich a backtest, results will be inflated garbage.

**Q-R7:** Add a hard rule: **LLM features exist only from the moment they were
generated live and recorded.** Backtests over earlier periods run without them (or
with them explicitly ablated). Corollary: any strategy that *depends* on LLM
features can only be evaluated forward, in paper — budget calendar time for that.

### R8. Regime dependence: a 2-year backtest is one regime, long-only doubles down

The proposed ≥2y window (2024–2026) is dominated by particular market conditions,
and both starter strategies are long-only. Strategies that look good in a trending
regime routinely die in ranging/bear regimes — the volatility-regime literature
above (R1) is one face of this non-stationarity.

**Q-R8:** (a) Extend backtests to include 2021–2022 (a full bull→bear cycle —
Kraken's bulk data reaches back far enough); (b) report results *per regime
segment*, not just aggregate; (c) state explicitly what the agent does in a bear
market — being flat for months is a legitimate answer, but say it.

### R9. Paper fills are systematically optimistic

The local PaperAdapter decides its own fills. Real fills involve queue position,
partial fills, and the fact that a resting maker order only fills when the market
trades *through* it (adverse selection: you're filled exactly when the move is
against you). This is the classic paper→live performance cliff.

**Q-R9:** Specify the fill model: taker fills at candle close ± slippage; maker
fills **only if the candle's range strictly crosses the limit price**, with
partial-fill simulation; a config flag for "pessimistic mode" used for all
go/no-go decisions. Bybit-demo results (real matching engine) should be compared
against PaperAdapter results as a calibration step in Phase 3.

---

## C. Operational and structural questions

### R10. 24/7 operations discipline

The market's advantage (always open) is the operator's liability (never off).
**Q-R10:** Where does the agent run (the dev laptop is the wrong answer for a
2-week unattended soak — a small VPS or always-on box)? What alerting exists for:
WebSocket disconnect/stale data (last-candle age watchdog), crash-loop, position
open longer than expected, daily-loss cutoff hit? Does the agent fail *closed*
(flat) or *open* (holding) on data loss — and is that choice documented per case?

### R11. Correlation makes "3 positions" nearly 1 position

BTC and ETH returns are highly correlated (typically 0.7–0.9). Three "diversified"
positions of 1% risk each behave like one ~3% position in stress — precisely when
correlations spike (a stylized fact across asset classes; crypto's joint tail
behavior is part of the fat-tail literature in R1).

**Q-R11:** Either cap *aggregate correlated* risk (treat BTC+ETH as one bucket) or
justify the current caps with measured correlation. Also revisit: is trading two
correlated pairs worth the added complexity in V1 at all?

### R12. Missing definitions the review could not evaluate

**Q-R12:** The spec never defines: (a) candle-close vs intra-candle decision timing
(decide only on closed candles — say it; acting on a forming candle is a subtle
repaint/look-ahead bug); (b) how the 4h context filter is computed without
look-ahead at 1h boundaries; (c) restart semantics — on reboot, does the agent
reconcile open positions from the exchange/journal before trading (it must);
(d) clock/timezone policy (exchange timestamps in UTC everywhere, no local time).

---

## Priority order for resolution

| Priority | Items | Why first |
|---|---|---|
| Before Phase 1 | R2 (backtest protocol), R7 (LLM look-ahead rule), R12a-b (decision timing) | These silently corrupt every result produced later |
| Before Phase 2 | R1 (vol-aware sizing), R4 (stop semantics), R9 (fill model), R11 (correlation) | Risk engine design inputs |
| Before Phase 3 | R3 (stopping rule), R8 (regime tests), R10 (ops) | Needed to interpret the soak run |
| Before any live | R5 (custody), R6 (quote currency, tax) | Real-money-only risks |

## Reviewer's overall note

Nothing here says "don't build it." It says: the enemy is not the market yet — it
is **your own evaluation process**. The literature is consistent that retail
trading losses come less from bad ideas than from overfitted validation of bad
ideas ([AMS 2014](https://www.ams.org/notices/201405/rnoti-p458.pdf)) and from
underestimated costs and tails ([Barber et al.](https://faculty.haas.berkeley.edu/odean/papers/Day%20Traders/Day%20Trade%20040330.pdf)).
The spec's engineering instincts (one code path, deterministic core, LLM outside
the order path) are exactly right; the discipline layer around experimentation is
what's missing.
