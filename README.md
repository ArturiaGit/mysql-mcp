# MySQL MCP — M0 engineering foundation

Use Node.js 22.22.0 and pnpm 10.32.1. Run `pnpm install --frozen-lockfile` from the repository root; it installs the commit-message hook. Do not push this foundation before review.

## Local metadata and health checks

1. Start Docker Desktop. In the shell set `MYSQL_ROOT_PASSWORD`, `METADATA_DB_USER` and `METADATA_DB_PASSWORD` to local-only values. Optional: `METADATA_DB_NAME` (default `mysql_mcp_metadata`), `METADATA_DB_HOST` (default `127.0.0.1`) and `METADATA_DB_PORT` (default `3306`). Compose also reads an ignored local `.env`; launch the Node processes with the same variables.
2. `node scripts/m0/mysql-up.mjs` waits for the loopback-only MySQL service to report healthy. The official image runs `docs/sql/001_metadata_schema.sql` on an empty data volume only. The script does not apply migrations or reset a volume. `docker compose down` stops the service without deleting its data.
3. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:guardrails`, `python scripts/generate_readiness_contracts.py --check` and `pnpm test:integration`. The integration test expects a fresh `PENDING` database and free ports `8081` and `8080`.
4. `pnpm --filter @mysql-mcp/admin-api start` and `pnpm --filter @mysql-mcp/gateway start` start the compiled hosts. Each defaults to loopback, and exposes `/health/live` and `/health/ready`. M0 readiness checks the metadata bootstrap row; it does not certify keyring integrity or serve business endpoints. Without a working metadata connection readiness fails closed.

## Frontend handoff

Step 1 provides a package-only `apps/admin-ui` scaffold. Step 2 should supply `build` and `test:e2e` scripts, enable the Vite manifest (`dist/.vite/manifest.json`), and label chunks `vendors` and `admin-ui-core` for the gzip budget. Browser E2E should manage its own backend/frontend process lifecycle and use the provisioned real MySQL. Releases and CI on `main` or targeting `main` reject the package-only placeholder. Configure branch and tag protection, CodeQL availability, Secret Scanning and Push Protection in the repository before any release.

The exported `ErrorCode` is the internal backend vocabulary. The published REST wire mapping and response shape are intentionally not exported: the API and backend design splits disagree on some codes and the requiredness of `action_guidance`, and M0 does not serve REST business routes.
