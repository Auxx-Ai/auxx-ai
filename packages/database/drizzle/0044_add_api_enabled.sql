ALTER TABLE "WorkflowApp" RENAME COLUMN "shareEnabled" TO "webEnabled";--> statement-breakpoint
ALTER TABLE "WorkflowApp" ALTER COLUMN "accessMode" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "WorkflowApp" ALTER COLUMN "accessMode" SET DEFAULT 'public'::text;--> statement-breakpoint
DROP TYPE "public"."WorkflowShareAccessMode";--> statement-breakpoint
CREATE TYPE "public"."WorkflowShareAccessMode" AS ENUM('public', 'organization');--> statement-breakpoint
ALTER TABLE "WorkflowApp" ALTER COLUMN "accessMode" SET DEFAULT 'public'::"public"."WorkflowShareAccessMode";--> statement-breakpoint
ALTER TABLE "WorkflowApp" ALTER COLUMN "accessMode" SET DATA TYPE "public"."WorkflowShareAccessMode" USING "accessMode"::"public"."WorkflowShareAccessMode";--> statement-breakpoint
DROP INDEX "WorkflowApp_shareEnabled_idx";--> statement-breakpoint
ALTER TABLE "WorkflowApp" ADD COLUMN "apiEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "WorkflowApp_webEnabled_idx" ON "WorkflowApp" USING btree ("webEnabled");--> statement-breakpoint
CREATE INDEX "WorkflowApp_apiEnabled_idx" ON "WorkflowApp" USING btree ("apiEnabled");