@AGENTS.md

## Claude Code specifics

- Journal/DB questions: query Postgres directly —
  `docker compose -f docker-compose.local.yml exec db psql -U micro -d microtrading -c "..."`.
  Tables: candles, journal (append-only), paper_account, experiments.
- Agent health: `curl -s localhost:3001/api/status | jq`. Use `/soak-check` for
  the full routine.
- Before claiming a fix works: `pnpm build && pnpm test`, and typecheck the
  agent with `./node_modules/.bin/tsc -p tsconfig.json --noEmit` from apps/agent.
- After changing agent code, redeploy with
  `docker compose -f docker-compose.local.yml up -d --build` — and verify the
  new file actually landed: `docker compose -f docker-compose.local.yml exec agent ls dist/...`.
- The soak (SPEC Phase 3) rewards boring uptime. Prefer minimal, reversible
  changes; anything touching the trading loop deserves a kill-switch-aware plan.
