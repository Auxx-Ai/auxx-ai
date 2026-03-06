ALTER TABLE "session" ADD COLUMN "impersonatedBy" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "bannedReason" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "bannedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "forcePasswordChange" boolean DEFAULT false NOT NULL;