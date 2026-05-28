ALTER TABLE "Thread" DROP CONSTRAINT "Thread_mergedById_User_id_fk";
--> statement-breakpoint
ALTER TABLE "Thread" ADD COLUMN "mergeData" jsonb;--> statement-breakpoint
ALTER TABLE "Thread" DROP COLUMN "mergedAt";--> statement-breakpoint
ALTER TABLE "Thread" DROP COLUMN "mergedById";