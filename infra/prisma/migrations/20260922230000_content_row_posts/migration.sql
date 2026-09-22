-- AlterTable
ALTER TABLE "ScheduledPost" ADD COLUMN     "contentRowId" TEXT,
ADD COLUMN     "permalink" TEXT;

-- CreateIndex
CREATE INDEX "ScheduledPost_contentRowId_idx" ON "ScheduledPost"("contentRowId");

-- AddForeignKey
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_contentRowId_fkey" FOREIGN KEY ("contentRowId") REFERENCES "DataTableRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
