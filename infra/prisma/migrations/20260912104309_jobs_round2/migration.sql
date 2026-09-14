-- Dedupe existing duplicate JobColumn rows (workspaceId, name) before the
-- unique index below can be created. A race in the lazy-seed endpoint let
-- two concurrent requests both see an empty board and each insert the 4
-- default columns; this keeps the oldest row per name and repoints any
-- job that landed on a newer duplicate onto it before dropping the dupes.
WITH ranked AS (
  SELECT id, "workspaceId", name,
         ROW_NUMBER() OVER (PARTITION BY "workspaceId", name ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "JobColumn"
),
winners AS (
  SELECT loser."id" AS loser_id, winner."id" AS winner_id
  FROM ranked loser
  JOIN ranked winner
    ON loser."workspaceId" = winner."workspaceId"
   AND loser.name = winner.name
   AND winner.rn = 1
  WHERE loser.rn > 1
)
UPDATE "Job" j
SET "columnId" = w.winner_id
FROM winners w
WHERE j."columnId" = w.loser_id;

WITH ranked AS (
  SELECT id, "workspaceId", name,
         ROW_NUMBER() OVER (PARTITION BY "workspaceId", name ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "JobColumn"
)
DELETE FROM "JobColumn" WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- CreateTable
CREATE TABLE "JobComment" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "taskId" TEXT,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobComment_jobId_createdAt_idx" ON "JobComment"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "TimeEntry_jobId_idx" ON "TimeEntry"("jobId");

-- CreateIndex
CREATE INDEX "TimeEntry_taskId_idx" ON "TimeEntry"("taskId");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_endedAt_idx" ON "TimeEntry"("userId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobColumn_workspaceId_name_key" ON "JobColumn"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "JobComment" ADD CONSTRAINT "JobComment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobComment" ADD CONSTRAINT "JobComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "JobTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
