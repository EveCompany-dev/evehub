-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('feed', 'story');

-- AlterTable
ALTER TABLE "ScheduledPost" ADD COLUMN     "postType" "PostType" NOT NULL DEFAULT 'feed';
