ALTER TABLE "Organization" ADD COLUMN "domains" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "Organization" DROP COLUMN "email_domain";