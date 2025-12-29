ALTER TABLE "PlanSubscription" ADD COLUMN "lastDeletionNotificationSent" text;--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "lastDeletionNotificationDate" timestamp (3);--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "deletionScheduledDate" timestamp (3);--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "deletionReason" text;