CREATE TABLE "TimelineEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"eventType" text NOT NULL,
	"startedAt" timestamp (3) NOT NULL,
	"endedAt" timestamp (3),
	"entityType" text NOT NULL,
	"entityId" text NOT NULL,
	"relatedEntityType" text,
	"relatedEntityId" text,
	"actorType" text,
	"actorId" text,
	"eventData" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changes" jsonb,
	"metadata" jsonb,
	"isGrouped" boolean DEFAULT false NOT NULL,
	"groupedEventIds" text[],
	"organizationId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "TimelineEvent_entity_idx" ON "TimelineEvent" USING btree ("organizationId","entityType","entityId","startedAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "TimelineEvent_actor_idx" ON "TimelineEvent" USING btree ("organizationId","actorType","actorId","startedAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "TimelineEvent_type_idx" ON "TimelineEvent" USING btree ("organizationId","eventType","startedAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "TimelineEvent_related_entity_idx" ON "TimelineEvent" USING btree ("organizationId","relatedEntityType","relatedEntityId","startedAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "TimelineEvent_org_timeline_idx" ON "TimelineEvent" USING btree ("organizationId","startedAt" DESC NULLS FIRST);