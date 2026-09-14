-- AlterEnum
-- Postgres refuses to use a newly added enum value inside the same
-- transaction that added it, so this migration only adds the value; the
-- worker that writes it runs in a later transaction entirely.
ALTER TYPE "NotificationType" ADD VALUE 'scheduledPostFailed';
