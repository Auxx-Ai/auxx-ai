ALTER TABLE "RecurrenceRule" DROP CONSTRAINT "RecurrenceRule_defaultAssigneeUserId_User_id_fk";
--> statement-breakpoint
ALTER TABLE "RecurrenceRule" ADD COLUMN "defaultAssigneeWorkerId" text;--> statement-breakpoint
ALTER TABLE "RecurrenceRule" ADD CONSTRAINT "RecurrenceRule_defaultAssigneeWorkerId_DispatchWorker_id_fk" FOREIGN KEY ("defaultAssigneeWorkerId") REFERENCES "public"."DispatchWorker"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
-- Backfill (plans/dispatch/45-teams.md §5.7): ensure an individual worker row exists for every
-- rule's default assignee, then map defaultAssigneeUserId → that worker row.
INSERT INTO "DispatchWorker" ("id", "organizationId", "type", "userId", "isActive", "routeStartAtHome", "routeEndAtHome", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, d."organizationId", 'individual', d."defaultAssigneeUserId", true, true, true, now(), now()
FROM (
	SELECT DISTINCT r."organizationId", r."defaultAssigneeUserId"
	FROM "RecurrenceRule" r
	WHERE r."defaultAssigneeUserId" IS NOT NULL
		AND NOT EXISTS (
			SELECT 1 FROM "DispatchWorker" w
			WHERE w."organizationId" = r."organizationId" AND w."userId" = r."defaultAssigneeUserId"
		)
) d;--> statement-breakpoint
UPDATE "RecurrenceRule" r
SET "defaultAssigneeWorkerId" = w."id"
FROM "DispatchWorker" w
WHERE r."defaultAssigneeUserId" IS NOT NULL
	AND w."organizationId" = r."organizationId"
	AND w."userId" = r."defaultAssigneeUserId"
	AND w."type" = 'individual';--> statement-breakpoint
ALTER TABLE "RecurrenceRule" DROP COLUMN "defaultAssigneeUserId";