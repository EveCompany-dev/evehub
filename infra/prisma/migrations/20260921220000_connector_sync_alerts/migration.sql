-- Notifications raised by the worker when an integration stops syncing, and
-- when the same integration starts working again.
ALTER TYPE "NotificationType" ADD VALUE 'connectorSyncFailed';
ALTER TYPE "NotificationType" ADD VALUE 'connectorSyncRecovered';
