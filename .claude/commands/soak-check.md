---
description: Health check of the trading agent on Railway (status, journal, services)
---

Run the MicroTrading health check. The agent runs on **Railway** (project
`microtrading`, region EU West) since 2026-11-10. The local Docker agent is stopped
and must stay stopped: two loops must never run at once.

1. `railway service list`: `agent`, `dashboard` and `Postgres` must all be Online.
2. Fetch `https://dashboard-production-257d.up.railway.app/agent/status` and verify
   `loopEnabled: true`, `killSwitch: false`, and `lastCandleTs` within the last
   2 hours (UTC epoch ms).
3. Fetch `.../agent/journal?limit=10`. Expect hourly decision+equity pairs at :02.
   Flag any `risk`, `mirror-error`, `stale-data-halt` or `tick-error` entries.
4. If a position is open, report qty/entry/stop and the distance of mark to stop.
   Do the same for `.../agent/shadow`.
5. If any `demo-fill` entries exist, mention that §6.3 calibration pairs are
   accumulating, and suggest running
   `railway ssh --service agent -- node dist/cli/calibrate-report.js`.

Report findings in 3–5 sentences, anomalies first. If data is stale for more than 2h,
check `railway logs --service agent`.
