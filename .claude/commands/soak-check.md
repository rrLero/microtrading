---
description: Health check of the soaking trading agent (status, journal, containers)
---

Run the MicroTrading soak health check:

1. `docker compose -f docker-compose.local.yml ps` — both `microtrading-db` and
   `microtrading-agent` must be Up (agent restart policy: unless-stopped).
2. `curl -s localhost:3001/api/status | jq` — verify: `loopEnabled: true`,
   `killSwitch: false`, `lastCandleTs` within the last 2 hours (UTC epoch ms).
3. `curl -s "localhost:3001/api/journal?limit=10" | jq` — hourly decision+equity
   pairs at :02; flag any `risk`, `mirror-error`, `stale-data-halt`, or
   `tick-error` entries.
4. If a position is open, report qty/entry/stop and distance of mark to stop.
5. If any `demo-fill` entries exist, mention that §6.3 calibration pairs are
   accumulating and suggest `pnpm --filter @microtrading/agent calibrate-report`.

Report findings in 3-5 sentences, anomalies first. If data is stale >2h,
suspect: Mac slept, Docker stopped, or Kraken ingestion failing — check
`docker compose -f docker-compose.local.yml logs --tail 50 agent`.
