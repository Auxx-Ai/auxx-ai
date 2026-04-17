CREATE TABLE "FreeToolLead" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"toolSlug" text NOT NULL,
	"referrer" text,
	"utmSource" text,
	"utmMedium" text,
	"utmCampaign" text,
	"ipAddress" text,
	"userAgent" text
);
--> statement-breakpoint
CREATE INDEX "FreeToolLead_toolSlug_idx" ON "FreeToolLead" USING btree ("toolSlug");--> statement-breakpoint
CREATE INDEX "FreeToolLead_email_idx" ON "FreeToolLead" USING btree ("email");--> statement-breakpoint
CREATE INDEX "FreeToolLead_createdAt_idx" ON "FreeToolLead" USING btree ("createdAt" DESC NULLS LAST);