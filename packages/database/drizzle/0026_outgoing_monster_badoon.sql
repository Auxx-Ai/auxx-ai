CREATE TABLE "WorkflowTemplate" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imgUrl" text,
	"graph" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'private' NOT NULL,
	"triggerType" text,
	"triggerConfig" jsonb,
	"envVars" jsonb,
	"variables" jsonb,
	"popularity" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "WorkflowTemplate_status_idx" ON "WorkflowTemplate" USING btree ("status");--> statement-breakpoint
CREATE INDEX "WorkflowTemplate_popularity_idx" ON "WorkflowTemplate" USING btree ("popularity" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "WorkflowTemplate_name_idx" ON "WorkflowTemplate" USING btree ("name");--> statement-breakpoint
CREATE INDEX "WorkflowTemplate_categories_idx" ON "WorkflowTemplate" USING gin ("categories");--> statement-breakpoint
ALTER TABLE "WorkflowNodeExecution" ADD CONSTRAINT "WorkflowNodeExecution_workflowAppId_WorkflowApp_id_fk" FOREIGN KEY ("workflowAppId") REFERENCES "public"."WorkflowApp"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkflowNodeExecution" ADD CONSTRAINT "WorkflowNodeExecution_workflowId_Workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."Workflow"("id") ON DELETE cascade ON UPDATE cascade;