ALTER TABLE "Agent" ALTER COLUMN "userId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "Agent" ADD COLUMN "config" jsonb;