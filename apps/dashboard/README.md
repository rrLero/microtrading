
## Running the dashboard

```bash
pnpm --filter @microtrading/dashboard dev    # http://localhost:3002
```

**Do not run `pnpm build` (repo root) while the dev server is running.** `next
build` and `next dev` share `apps/dashboard/.next` and write incompatible
manifests into it; the dev server then serves HTTP 500 with
`Could not find the module ... in the React Client Manifest` or a blank page.
Recovery is: stop the dev server, `rm -rf apps/dashboard/.next`, start it again.

Turbo's `pnpm build` at the repo root includes the dashboard, so this bites any
full-repo build during development. Stop the dev server first, or build only
what you need: `pnpm --filter @microtrading/agent build`.
