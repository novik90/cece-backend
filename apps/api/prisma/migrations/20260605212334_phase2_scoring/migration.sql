-- CreateEnum
CREATE TYPE "FrameStatus" AS ENUM ('in_progress', 'completed');

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "first_breaker_slot" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "self_scoring_disabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "frames" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "frame_number" INTEGER NOT NULL,
    "breaker_slot" INTEGER NOT NULL,
    "status" "FrameStatus" NOT NULL DEFAULT 'in_progress',
    "winner_slot" INTEGER,
    "score_a" INTEGER NOT NULL DEFAULT 0,
    "score_b" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "frames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_events" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "frame_id" TEXT,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "frames_match_id_idx" ON "frames"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "frames_match_id_frame_number_key" ON "frames"("match_id", "frame_number");

-- CreateIndex
CREATE INDEX "match_events_match_id_idx" ON "match_events"("match_id");

-- CreateIndex
CREATE INDEX "match_events_frame_id_idx" ON "match_events"("frame_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_events_match_id_seq_key" ON "match_events"("match_id", "seq");

-- AddForeignKey
ALTER TABLE "frames" ADD CONSTRAINT "frames_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_frame_id_fkey" FOREIGN KEY ("frame_id") REFERENCES "frames"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_by_user_id_fkey" FOREIGN KEY ("by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
