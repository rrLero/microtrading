@AGENTS.md

## Claude Code specifics

- **Production runs on Railway** (project `microtrading`, EU West) since 2026-11-10.
  The local Docker agent is STOPPED. Never start it while Railway's agent runs
  (two loops). The local `db` container is a frozen backup as of 2026-11-10 09:19Z.
- Journal/DB questions (live data):
  `railway ssh --service Postgres -- sh -c 'psql -U $PGUSER -d $PGDATABASE -c "..."'`.
  Tables: candles, journal (append-only), paper_account, experiments, funding_rates.
- Agent health: `https://dashboard-production-257d.up.railway.app/agent/status`
  (read-only proxy). Use `/soak-check` for the full routine.
- Agent CLIs run inside the container, with the env already set:
  `railway ssh --service agent -- node dist/cli/<name>.js [args]`
  (e.g. `kill-switch.js on|off`, `shadow-verdict.js`, `calibrate-report.js`).
- Before claiming a fix works: `pnpm build && pnpm test`, and typecheck the
  agent with `./node_modules/.bin/tsc -p tsconfig.json --noEmit` from apps/agent.
- **Every push to `main` auto-deploys the agent and the dashboard on Railway.**
  Push only between :10 and :55 UTC, never across the :02/:04/:07 ticks or the
  13:37 probe. Verify it landed with `railway ssh --service agent -- ls dist/...`.
- The soak (SPEC Phase 3) rewards boring uptime. Prefer minimal, reversible
  changes; anything touching the trading loop deserves a kill-switch-aware plan.
