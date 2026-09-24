-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "concludedAt" TIMESTAMP(3),
ADD COLUMN     "concludedBy" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" TEXT,
ADD COLUMN     "responsibleId" TEXT;

-- CreateIndex
CREATE INDEX "Job_responsibleId_idx" ON "Job"("responsibleId");

-- CreateIndex
CREATE INDEX "Job_workspaceId_deletedAt_idx" ON "Job"("workspaceId", "deletedAt");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
