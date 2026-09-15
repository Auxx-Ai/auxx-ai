ALTER TABLE "Credential" ADD CONSTRAINT "Credential_org_id_key" UNIQUE("organizationId","id");--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD CONSTRAINT "EntityInstance_org_id_key" UNIQUE("organizationId","id");--> statement-breakpoint
ALTER TABLE "GlPosting" ADD CONSTRAINT "GlPosting_org_id_key" UNIQUE("organizationId","id");