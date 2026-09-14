/*
  Warnings:

  - You are about to drop the column `clientSourceInstanceId` on the `Workspace` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Workspace" DROP COLUMN "clientSourceInstanceId";
