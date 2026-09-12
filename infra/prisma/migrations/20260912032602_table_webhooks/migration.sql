-- AlterTable
ALTER TABLE "DataTable" ADD COLUMN     "webhookKeyColumn" TEXT,
ADD COLUMN     "webhookToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DataTable_webhookToken_key" ON "DataTable"("webhookToken");
