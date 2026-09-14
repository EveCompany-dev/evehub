-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'markedImportant';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "important" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "JobTask" ADD COLUMN     "important" BOOLEAN NOT NULL DEFAULT false;
