# cece-backend — guide for Claude

Backend for the **ce·ce** snooker app. Single backend for iOS / Android / Web clients.

## Principles (do not break)

- **Server-authoritative.** Snooker rules and scoring live only on the server (`packages/engine`); clients send actions, server validates and broadcasts state.
- **Contract-first.** `packages/contract` is the single source of truth for request/response/event types and zod schemas. API and clients follow it.
- **Thin, online-only clients.** The engine is not duplicated on clients.
- **API conventions:** base `/v1`, `Authorization: Bearer <jwt>`, JSON, errors as `{ "error": { "code", "message" } }`, input validated with zod.

## Layout (monorepo, pnpm + Turborepo)

- `apps/api` — NestJS server (HTTP, later Socket.IO). Owns DB access via Prisma (`apps/api/prisma`).
- `packages/contract` — shared types + zod schemas.
- `packages/engine` — snooker engine (Phase 2).

## Requirements

- **Node 20** (see `.nvmrc`). **pnpm 9** (`corepack enable`, or run via `corepack pnpm@9.15.0 …`).
- **Docker** — for the local Postgres (`docker compose`). Managed Postgres later (just swap `DATABASE_URL`).

## Commands

Run from the repo root (Turborepo fans out to all packages):

| Command          | What it does                                  |
| ---------------- | --------------------------------------------- |
| `pnpm install`   | Install all workspace deps                    |
| `pnpm dev`       | Run the API in watch mode (builds deps first) |
| `pnpm start`     | Build, then run the API once                  |
| `pnpm build`     | Build every package (`apps/*`, `packages/*`)  |
| `pnpm test`      | Run unit + e2e tests (vitest)                 |
| `pnpm lint`      | ESLint across the monorepo                    |
| `pnpm typecheck` | TypeScript `--noEmit` per package             |
| `pnpm format`    | Prettier write                                |

Run the API locally: `pnpm dev` (watch) or `pnpm start` (build + run) → health check at
`GET http://localhost:3000/v1/health`. Override the port with `PORT=3001 pnpm start`.

### Database (local Postgres via Docker)

| Command            | What it does                                           |
| ------------------ | ------------------------------------------------------ |
| `pnpm db:up`       | Start local Postgres (`docker compose up -d`)          |
| `pnpm db:down`     | Stop it (data persists in the `cece_pgdata` volume)    |
| `pnpm db:migrate`  | Apply/create migrations (`prisma migrate dev`)         |
| `pnpm db:generate` | Regenerate Prisma Client (also runs on `pnpm install`) |
| `pnpm db:studio`   | Open Prisma Studio                                     |

First-time setup:

```bash
cp apps/api/.env.example apps/api/.env   # DATABASE_URL (compose DB) + JWT_SECRET
pnpm db:up
pnpm db:migrate
pnpm dev
```

Schema lives in `apps/api/prisma/schema.prisma`; migrations in `apps/api/prisma/migrations`.

## Testing

`pnpm test` runs vitest across the monorepo. In `apps/api`:

- **Unit specs** (`*.spec.ts`, colocated) test services in isolation with a mocked Prisma.
- **E2E / contract specs** (`*.e2e.spec.ts`) boot the real Nest app over an in-memory Prisma fake (`src/test-support/`) and drive it with supertest — no Postgres needed. They assert the HTTP contract: status codes, the `{ error }` envelope, the JWT guard, and authz.

`apps/api/vitest.config.ts` transpiles with SWC so Nest's decorator metadata works under vitest. E2E specs and `src/test-support/` are excluded from the production build (`tsconfig.build.json`).

## Process

See Obsidian `AI контекст/cece/Правила разработки`. In short: every change needs a GitHub issue;
each task on its own branch (`feature/…` / `fix/…`); PRs target `main`; **the user merges, not Claude**.
Board: GitHub Projects «cece» (owner `novik90`, project #1).

## Roadmap

- **Phase 1 ✅ done:** Auth + Users + basic Matches (CRUD, no real-time). Contract: Obsidian `cece app/cece-backend/Контракты v1`; endpoint reference: `… Справочник API v1 — ручки`.
- **Phase 2 (next):** real-time scoring (engine + WebSocket + active-scorer queue).
- **Phase 3:** tournaments, invites, friends. **Phase 4:** Android + Web clients.
