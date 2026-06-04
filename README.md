# cece-backend

Backend for the **ce·ce** snooker app — a single backend for iOS / Android / Web clients.
Server-authoritative, contract-first, thin online-only clients.

## Stack

TypeScript / Node 20 · NestJS · PostgreSQL + Prisma (added in a later task) · Socket.IO (Phase 2).
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

pnpm --filter @cece/api dev   # run the API → GET http://localhost:3000/v1/health
```

## Development

Conventions and the contributor guide for AI agents live in [`CLAUDE.md`](./CLAUDE.md).
Every change is tracked by a GitHub issue and done on its own branch; PRs target `main`.
