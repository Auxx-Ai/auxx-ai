CREATE TABLE "AuditLog" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"targetType" text,
	"targetId" text,
	"actorType" text NOT NULL,
	"actorId" text,
	"ipAddress" text,
	"userAgent" text,
	"sessionId" text,
	"reason" text,
	"previousState" jsonb,
	"newState" jsonb,
	"metadata" jsonb,
	"visibility" text DEFAULT 'admin' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PlanSubscription" ADD COLUMN "shopifyShopGid" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AuditLog_org_createdAt_idx" ON "AuditLog" USING btree ("organizationId","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "AuditLog_org_category_idx" ON "AuditLog" USING btree ("organizationId","category");--> statement-breakpoint
CREATE INDEX "AuditLog_org_visibility_createdAt_idx" ON "AuditLog" USING btree ("organizationId","visibility","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog" USING btree ("actorId");--> statement-breakpoint
CREATE INDEX "AuditLog_target_idx" ON "AuditLog" USING btree ("targetType","targetId");--> statement-breakpoint
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" USING btree ("createdAt" DESC NULLS LAST);