CREATE TYPE "public"."ApprovalKind" AS ENUM('workflow', 'access');--> statement-breakpoint
ALTER TYPE "public"."ApprovalStatus" ADD VALUE 'withdrawn';--> statement-breakpoint
ALTER TYPE "public"."ApprovalStatus" ADD VALUE 'superseded';--> statement-breakpoint
ALTER TYPE "public"."NotificationType" ADD VALUE 'ACCESS_REQUESTED';--> statement-breakpoint
ALTER TYPE "public"."NotificationType" ADD VALUE 'ACCESS_REQUEST_DECIDED';--> statement-breakpoint
--> HAND-FIXED (plans/permissions/v2/28 §3): drizzle-kit emitted this as an
--> `ADD COLUMN "subjectLabel" text NOT NULL` plus a `DROP COLUMN "workflowName"`.
--> That is wrong twice over: `ADD COLUMN ... NOT NULL` with no DEFAULT FAILS
--> outright on a non-empty table, and even with one it would blank the label on
--> every existing row. `workflowName` is a denormalized display string both kinds
--> now render, so the column is RENAMED and reused.
ALTER TABLE "ApprovalRequest" RENAME COLUMN "workflowName" TO "subjectLabel";--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ALTER COLUMN "workflowId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ALTER COLUMN "workflowRunId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ALTER COLUMN "nodeId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ALTER COLUMN "nodeName" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD COLUMN "kind" "ApprovalKind" DEFAULT 'workflow' NOT NULL;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD COLUMN "requesterId" text;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD COLUMN "targetKind" text;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD COLUMN "entityDefinitionId" text;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD COLUMN "entityInstanceId" text;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD COLUMN "requestedLevel" text;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD COLUMN "grantedLevel" text;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD COLUMN "requestedLens" text;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD COLUMN "grantedLens" text;--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requesterId_User_id_fk" FOREIGN KEY ("requesterId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ApprovalRequest_access_area_pending_key" ON "ApprovalRequest" USING btree ("organizationId","requesterId","area") WHERE kind = 'access' AND status = 'pending' AND "targetKind" = 'area';--> statement-breakpoint
CREATE UNIQUE INDEX "ApprovalRequest_access_def_pending_key" ON "ApprovalRequest" USING btree ("organizationId","requesterId","entityDefinitionId") WHERE kind = 'access' AND status = 'pending' AND "targetKind" = 'def';--> statement-breakpoint
CREATE UNIQUE INDEX "ApprovalRequest_access_instance_pending_key" ON "ApprovalRequest" USING btree ("organizationId","requesterId","entityDefinitionId","entityInstanceId") WHERE kind = 'access' AND status = 'pending' AND "targetKind" = 'instance';--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workflow_columns_check" CHECK (("ApprovalRequest"."kind" = 'workflow') = ("ApprovalRequest"."workflowRunId" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_access_area_shape_check" CHECK ("ApprovalRequest"."targetKind" <> 'area' OR ("ApprovalRequest"."area" IS NOT NULL AND "ApprovalRequest"."entityDefinitionId" IS NULL AND "ApprovalRequest"."entityInstanceId" IS NULL));--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_access_def_shape_check" CHECK ("ApprovalRequest"."targetKind" <> 'def' OR ("ApprovalRequest"."entityDefinitionId" IS NOT NULL AND "ApprovalRequest"."entityInstanceId" IS NULL AND "ApprovalRequest"."area" IS NULL));--> statement-breakpoint
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_access_instance_shape_check" CHECK ("ApprovalRequest"."targetKind" <> 'instance' OR ("ApprovalRequest"."entityDefinitionId" IS NOT NULL AND "ApprovalRequest"."entityInstanceId" IS NOT NULL AND "ApprovalRequest"."area" IS NULL));