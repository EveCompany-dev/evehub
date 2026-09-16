-- DropForeignKey
ALTER TABLE "EditLog" DROP CONSTRAINT "EditLog_userId_fkey";

-- AlterTable
ALTER TABLE "EditLog" ADD COLUMN     "userLabel" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "EditLog" ADD CONSTRAINT "EditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
