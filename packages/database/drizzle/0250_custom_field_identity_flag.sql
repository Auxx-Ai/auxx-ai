ALTER TABLE "CustomField" ADD COLUMN "isIdentity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "CustomField" ADD COLUMN "appSlug" text;