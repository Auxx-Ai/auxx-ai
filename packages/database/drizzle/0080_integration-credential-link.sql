ALTER TABLE "WorkflowCredentials" ALTER COLUMN "createdById" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "Integration" ADD COLUMN "credentialId" text;--> statement-breakpoint
ALTER TABLE "Integration" ADD COLUMN "requiresReauth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Integration" ADD COLUMN "lastAuthError" text;--> statement-breakpoint
ALTER TABLE "Integration" ADD COLUMN "lastAuthErrorAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_credentialId_WorkflowCredentials_id_fk" FOREIGN KEY ("credentialId") REFERENCES "public"."WorkflowCredentials"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Integration_credentialId_idx" ON "Integration" USING btree ("credentialId");--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "refreshToken";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "accessToken";