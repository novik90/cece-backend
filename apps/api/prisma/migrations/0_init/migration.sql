-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('scheduled', 'live', 'completed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "best_of" INTEGER NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'scheduled',
    "frames_won_a" INTEGER NOT NULL DEFAULT 0,
    "frames_won_b" INTEGER NOT NULL DEFAULT 0,
    "winner_slot" INTEGER,
    "active_scorer_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_participants" (
    "match_id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "user_id" TEXT,
    "guest_name" TEXT,

    CONSTRAINT "match_participants_pkey" PRIMARY KEY ("match_id","slot")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_handle_key" ON "users"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "matches_owner_id_idx" ON "matches"("owner_id");

-- CreateIndex
CREATE INDEX "match_participants_user_id_idx" ON "match_participants"("user_id");

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_active_scorer_user_id_fkey" FOREIGN KEY ("active_scorer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

