CREATE TABLE "DispatchTeamMember" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"teamWorkerId" text NOT NULL,
	"memberWorkerId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" DROP CONSTRAINT "WorkOrderVisit_assigneeUserId_User_id_fk";
--> statement-breakpoint
DROP INDEX "WorkOrderVisit_assigneeUserId_startTime_idx";--> statement-breakpoint
DROP INDEX "DispatchWorker_organizationId_userId_key";--> statement-breakpoint
ALTER TABLE "DispatchWorker" ALTER COLUMN "userId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "DispatchWorker" ADD COLUMN "type" text DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "DispatchWorker" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" ADD COLUMN "assigneeWorkerId" text;--> statement-breakpoint
ALTER TABLE "DispatchTeamMember" ADD CONSTRAINT "DispatchTeamMember_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DispatchTeamMember" ADD CONSTRAINT "DispatchTeamMember_teamWorkerId_DispatchWorker_id_fk" FOREIGN KEY ("teamWorkerId") REFERENCES "public"."DispatchWorker"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DispatchTeamMember" ADD CONSTRAINT "DispatchTeamMember_memberWorkerId_DispatchWorker_id_fk" FOREIGN KEY ("memberWorkerId") REFERENCES "public"."DispatchWorker"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "DispatchTeamMember_teamWorkerId_memberWorkerId_key" ON "DispatchTeamMember" USING btree ("teamWorkerId","memberWorkerId");--> statement-breakpoint
CREATE INDEX "DispatchTeamMember_memberWorkerId_idx" ON "DispatchTeamMember" USING btree ("memberWorkerId");--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" ADD CONSTRAINT "WorkOrderVisit_assigneeWorkerId_DispatchWorker_id_fk" FOREIGN KEY ("assigneeWorkerId") REFERENCES "public"."DispatchWorker"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "WorkOrderVisit_assigneeWorkerId_startTime_idx" ON "WorkOrderVisit" USING btree ("assigneeWorkerId","startTime");--> statement-breakpoint
CREATE UNIQUE INDEX "DispatchWorker_organizationId_userId_key" ON "DispatchWorker" USING btree ("organizationId","userId") WHERE "DispatchWorker"."userId" IS NOT NULL;--> statement-breakpoint
-- Backfill (plans/dispatch/45-teams.md §4): create an individual worker row for every distinct
-- assignee that has no DispatchWorker row yet (assignees whose board row was removed).
INSERT INTO "DispatchWorker" ("id", "organizationId", "type", "userId", "isActive", "routeStartAtHome", "routeEndAtHome", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, d."organizationId", 'individual', d."assigneeUserId", true, true, true, now(), now()
FROM (
	SELECT DISTINCT v."organizationId", v."assigneeUserId"
	FROM "WorkOrderVisit" v
	WHERE v."assigneeUserId" IS NOT NULL
		AND NOT EXISTS (
			SELECT 1 FROM "DispatchWorker" w
			WHERE w."organizationId" = v."organizationId" AND w."userId" = v."assigneeUserId"
		)
) d;--> statement-breakpoint
-- Point each visit at its assignee's individual worker row.
UPDATE "WorkOrderVisit" v
SET "assigneeWorkerId" = w."id"
FROM "DispatchWorker" w
WHERE v."assigneeUserId" IS NOT NULL
	AND w."organizationId" = v."organizationId"
	AND w."userId" = v."assigneeUserId"
	AND w."type" = 'individual';--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" DROP COLUMN "assigneeUserId";