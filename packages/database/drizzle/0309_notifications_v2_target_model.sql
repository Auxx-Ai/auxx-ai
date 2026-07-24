ALTER TYPE "public"."NotificationType" ADD VALUE 'TASK_ASSIGNED';--> statement-breakpoint
ALTER TYPE "public"."NotificationType" ADD VALUE 'RESOURCE_SHARED';--> statement-breakpoint
ALTER TYPE "public"."NotificationType" ADD VALUE 'MESSAGE_SHARED';--> statement-breakpoint
ALTER TABLE "Notification" ADD COLUMN "targetType" text;--> statement-breakpoint
ALTER TABLE "Notification" ADD COLUMN "targetIds" jsonb;--> statement-breakpoint
UPDATE "Notification"
SET "targetType" = 'APPROVAL',
    "targetIds" = jsonb_build_object('approvalRequestId', "entityId")
WHERE "entityType" = 'approval_request';--> statement-breakpoint
UPDATE "Notification"
SET "targetType" = 'THREAD',
    "targetIds" = jsonb_build_object('threadId', "entityId")
WHERE "entityType" = 'Thread';--> statement-breakpoint
UPDATE "Notification"
SET "targetType" = 'TASK',
    "targetIds" = jsonb_build_object('taskId', "entityId")
WHERE "entityType" = 'task';--> statement-breakpoint
UPDATE "Notification"
SET "targetType" = 'SETTINGS',
    "targetIds" = jsonb_build_object(
      'path',
      CASE
        WHEN "entityType" = 'organization' THEN '/app/settings/billing'
        ELSE '/app/settings/general'
      END
    )
WHERE "entityType" IN ('organization', 'Organization');--> statement-breakpoint
UPDATE "Notification" n
SET "targetType" = 'COMMENT',
    "targetIds" = jsonb_build_object(
      'commentId', c."id",
      'recordId', c."entityDefinitionId" || ':' || c."entityId"
    )
FROM "Comment" c
WHERE c."id" = n."entityId"
  AND n."entityType" = 'Comment';--> statement-breakpoint
UPDATE "Notification" n
SET "targetType" = 'ENTITY_INSTANCE',
    "targetIds" = jsonb_build_object(
      'entityDefinitionId', ei."entityDefinitionId",
      'entityInstanceId', ei."id"
    )
FROM "EntityInstance" ei
WHERE ei."id" = n."entityId"
  AND n."targetType" IS NULL;--> statement-breakpoint
DELETE FROM "Notification" WHERE "targetType" IS NULL;--> statement-breakpoint
ALTER TABLE "Notification" ALTER COLUMN "targetType" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "Notification" ALTER COLUMN "targetIds" SET NOT NULL;--> statement-breakpoint
DROP INDEX "Notification_entityType_entityId_idx";--> statement-breakpoint
DROP INDEX "Notification_userId_createdAt_idx";--> statement-breakpoint
CREATE INDEX "Notification_targetType_idx" ON "Notification" USING btree ("targetType");--> statement-breakpoint
CREATE INDEX "Notification_userId_org_createdAt_idx" ON "Notification" USING btree ("userId","organizationId","createdAt" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
ALTER TABLE "Notification" DROP COLUMN "entityId";--> statement-breakpoint
ALTER TABLE "Notification" DROP COLUMN "entityType";
