ALTER TYPE "public"."SendStatus" ADD VALUE 'BOUNCED';--> statement-breakpoint
CREATE TABLE "EntitySignalRollup" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"entityInstanceId" text NOT NULL,
	"lastOpenedAt" timestamp (3),
	"openCount30d" integer DEFAULT 0 NOT NULL,
	"lastClickedAt" timestamp (3),
	"clickCount30d" integer DEFAULT 0 NOT NULL,
	"lastVisitAt" timestamp (3),
	"visitCount30d" integer DEFAULT 0 NOT NULL,
	"lastRepliedAt" timestamp (3),
	"lastSignalAt" timestamp (3),
	"unsubscribedAt" timestamp (3),
	"bouncedAt" timestamp (3),
	"bounceType" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "EntitySignal_contactEntityInstanceId_idx";--> statement-breakpoint
ALTER TABLE "EntitySignalRollup" ADD CONSTRAINT "EntitySignalRollup_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntitySignalRollup" ADD CONSTRAINT "EntitySignalRollup_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "EntitySignalRollup_organizationId_entityInstanceId_key" ON "EntitySignalRollup" USING btree ("organizationId","entityInstanceId");--> statement-breakpoint
CREATE INDEX "EntitySignal_organizationId_contactEntityInstanceId_occurredAt_idx" ON "EntitySignal" USING btree ("organizationId","contactEntityInstanceId","occurredAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "EntitySignal_organizationId_kind_occurredAt_idx" ON "EntitySignal" USING btree ("organizationId","kind","occurredAt" DESC NULLS LAST);