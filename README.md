# cece-backend

Backend for the **ce·ce** snooker app — a single backend for iOS / Android / Web clients.
Server-authoritative, contract-first, thin online-only clients.

## Stack

TypeScript / Node 20 · NestJS · PostgreSQL + Prisma · Socket.IO (Phase 2).
Monorepo with pnpm + Turborepo.

```
apps/api            NestJS server (HTTP; WebSocket later)
packages/contract   Shared types + zod schemas (source of truth)
packages/engine     Snooker engine (Phase 2)
```

## Getting started

Requires **Node 20** (`.nvmrc`) and **pnpm 9** (`corepack enable`).

```bash
pnpm install
pnpm build          # build all packages
pnpm test           # run tests
pnpm lint           # lint
pnpm typecheck      # type-check

pnpm dev            # run the API in watch mode → GET http://localhost:3000/v1/health
pnpm start          # build, then run the API once
```

### Database (local Postgres via Docker)

Requires **Docker**. Later we point `DATABASE_URL` at a managed Postgres — no code changes.

```bash
cp apps/api/.env.example apps/api/.env   # DATABASE_URL → the compose DB; JWT_SECRET
pnpm db:up          # start Postgres (docker compose)
pnpm db:migrate     # apply migrations
pnpm db:studio      # browse data (optional)
```

## API (Phase 1)

Base `/v1`, JSON, `Authorization: Bearer <jwt>` where noted (🔒), errors as `{ "error": { "code", "message" } }`.

| Method & path              | Auth | Purpose                                          |
| -------------------------- | :--: | ------------------------------------------------ |
| `GET /v1/health`           |      | Liveness check                                   |
| `POST /v1/auth/register`   |      | Register, returns JWT + user                     |
| `POST /v1/auth/login`      |      | Login, returns JWT + user                        |
| `GET /v1/me`               |  🔒  | Current user profile                             |
| `GET /v1/users?handle=…`   |  🔒  | Prefix search by handle                          |
| `POST /v1/matches`         |  🔒  | Create a match (vs registered user or guest)     |
| `GET /v1/matches?status=…` |  🔒  | List my matches (`all` \| `live` \| `completed`) |
| `GET /v1/matches/:id`      |  🔒  | Get one match (participants only)                |

Types and zod schemas are the source of truth in [`packages/contract`](./packages/contract).
Full request/response reference (fields, examples, error codes) lives in Obsidian:
`cece app/cece-backend/Справочник API v1 — ручки (запрос ⇄ ответ)`.

## Testing

`pnpm test` runs vitest across the monorepo. `apps/api` has **unit specs** (`*.spec.ts`,
mocked Prisma) and **e2e/contract specs** (`*.e2e.spec.ts`) that boot the real Nest app
over an in-memory Prisma fake and drive it with supertest — no Postgres required.

## Development

Conventions and the contributor guide for AI agents live in [`CLAUDE.md`](./CLAUDE.md).
Every change is tracked by a GitHub issue and done on its own branch; PRs target `main`.
