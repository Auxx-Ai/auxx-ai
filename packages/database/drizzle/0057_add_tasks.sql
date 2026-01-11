CREATE TABLE "Task" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"deadline" timestamp (3),
	"completedAt" timestamp (3),
	"createdById" text NOT NULL,
	"completedById" text,
	"priority" text,
	"archivedAt" timestamp (3),
	"searchText" text NOT NULL,
	"assignedUserCount" integer DEFAULT 0 NOT NULL,
	"referenceCount" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TaskAssignment" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"taskId" text NOT NULL,
	"assignedToUserId" text NOT NULL,
	"assignedAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"assignedById" text NOT NULL,
	"unassignedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "TaskReference" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"taskId" text NOT NULL,
	"referencedEntityInstanceId" text NOT NULL,
	"referencedEntityDefinitionId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"createdById" text NOT NULL,
	"deletedAt" timestamp (3)
);
--> statement-breakpoint
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Task" ADD CONSTRAINT "Task_completedById_User_id_fk" FOREIGN KEY ("completedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_Task_id_fk" FOREIGN KEY ("taskId") REFERENCES "public"."Task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_assignedToUserId_User_id_fk" FOREIGN KEY ("assignedToUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_assignedById_User_id_fk" FOREIGN KEY ("assignedById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TaskReference" ADD CONSTRAINT "TaskReference_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TaskReference" ADD CONSTRAINT "TaskReference_taskId_Task_id_fk" FOREIGN KEY ("taskId") REFERENCES "public"."Task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TaskReference" ADD CONSTRAINT "TaskReference_referencedEntityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("referencedEntityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TaskReference" ADD CONSTRAINT "TaskReference_referencedEntityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("referencedEntityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TaskReference" ADD CONSTRAINT "TaskReference_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Task_organizationId_idx" ON "Task" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Task_organizationId_archivedAt_deadline_idx" ON "Task" USING btree ("organizationId","archivedAt","deadline");--> statement-breakpoint
CREATE INDEX "Task_organizationId_createdById_idx" ON "Task" USING btree ("organizationId","createdById");--> statement-breakpoint
CREATE INDEX "Task_organizationId_deadline_idx" ON "Task" USING btree ("organizationId","deadline");--> statement-breakpoint
CREATE INDEX "Task_organizationId_createdAt_idx" ON "Task" USING btree ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "Task_organizationId_completedAt_idx" ON "Task" USING btree ("organizationId","completedAt");--> statement-breakpoint
CREATE INDEX "TaskAssignment_organizationId_idx" ON "TaskAssignment" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "TaskAssignment_taskId_idx" ON "TaskAssignment" USING btree ("taskId");--> statement-breakpoint
CREATE INDEX "TaskAssignment_assignedToUserId_idx" ON "TaskAssignment" USING btree ("assignedToUserId");--> statement-breakpoint
CREATE INDEX "TaskAssignment_organizationId_assignedToUserId_unassignedAt_idx" ON "TaskAssignment" USING btree ("organizationId","assignedToUserId","unassignedAt");--> statement-breakpoint
CREATE INDEX "TaskAssignment_taskId_assignedAt_idx" ON "TaskAssignment" USING btree ("taskId","assignedAt");--> statement-breakpoint
CREATE INDEX "TaskAssignment_unassignedAt_idx" ON "TaskAssignment" USING btree ("unassignedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "TaskAssignment_taskId_assignedToUserId_key" ON "TaskAssignment" USING btree ("taskId","assignedToUserId");--> statement-breakpoint
CREATE INDEX "TaskReference_organizationId_idx" ON "TaskReference" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "TaskReference_taskId_idx" ON "TaskReference" USING btree ("taskId");--> statement-breakpoint
CREATE INDEX "TaskReference_referencedEntityInstanceId_idx" ON "TaskReference" USING btree ("referencedEntityInstanceId");--> statement-breakpoint
CREATE INDEX "TaskReference_referencedEntityDefinitionId_idx" ON "TaskReference" USING btree ("referencedEntityDefinitionId");--> statement-breakpoint
CREATE INDEX "TaskReference_organizationId_referencedEntityInstanceId_deletedAt_idx" ON "TaskReference" USING btree ("organizationId","referencedEntityInstanceId","deletedAt");--> statement-breakpoint
CREATE INDEX "TaskReference_deletedAt_idx" ON "TaskReference" USING btree ("deletedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "TaskReference_taskId_referencedEntityInstanceId_key" ON "TaskReference" USING btree ("taskId","referencedEntityInstanceId");