-- AlterTable
ALTER TABLE "ConnectorInstance" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE INDEX "ConnectorInstance_clientId_idx" ON "ConnectorInstance"("clientId");

-- AddForeignKey
ALTER TABLE "ConnectorInstance" ADD CONSTRAINT "ConnectorInstance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
