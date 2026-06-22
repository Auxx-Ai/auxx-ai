ALTER TABLE "ConnectionDefinition" ADD COLUMN "platformClientApproved" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "Credential" ADD COLUMN "lastAuthError" text;--> statement-breakpoint
ALTER TABLE "Credential" ADD COLUMN "lastAuthErrorAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Credential" ADD COLUMN "requiresReauth" boolean DEFAULT false NOT NULL;