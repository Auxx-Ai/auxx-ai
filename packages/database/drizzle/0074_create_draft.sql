CREATE TABLE "Draft" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdById" text NOT NULL,
	"threadId" text,
	"inReplyToMessageId" text,
	"integrationId" text NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"providerId" text,
	"providerThreadId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "TagsOnThread" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "TagsOnThread" CASCADE;--> statement-breakpoint
DROP INDEX "Message_threadId_createdById_draftMode_idx";--> statement-breakpoint
DROP INDEX "thread_messages_idx";--> statement-breakpoint
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_inReplyToMessageId_Message_id_fk" FOREIGN KEY ("inReplyToMessageId") REFERENCES "public"."Message"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_integrationId_Integration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."Integration"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Draft_organizationId_idx" ON "Draft" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Draft_createdById_idx" ON "Draft" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "Draft_threadId_idx" ON "Draft" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX "Draft_integrationId_idx" ON "Draft" USING btree ("integrationId");--> statement-breakpoint
CREATE UNIQUE INDEX "Draft_threadId_createdById_key" ON "Draft" USING btree ("threadId","createdById") WHERE ("threadId" IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "Draft_organizationId_providerId_key" ON "Draft" USING btree ("organizationId","providerId") WHERE ("providerId" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "Draft_organizationId_createdById_idx" ON "Draft" USING btree ("organizationId","createdById");--> statement-breakpoint
CREATE INDEX "Message_threadId_createdById_idx" ON "Message" USING btree ("threadId","createdById");--> statement-breakpoint
CREATE INDEX "thread_messages_idx" ON "Message" USING btree ("threadId","sentAt");--> statement-breakpoint
ALTER TABLE "Message" DROP COLUMN "draftMode";--> statement-breakpoint
DROP TYPE "public"."DraftMode";