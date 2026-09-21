-- AlterTable
ALTER TABLE "DataTable" ADD COLUMN     "kind" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DataTable_workspaceId_kind_key" ON "DataTable"("workspaceId", "kind");
