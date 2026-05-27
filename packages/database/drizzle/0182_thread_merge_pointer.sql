ALTER TABLE "Thread" ADD COLUMN "mergedIntoThreadId" text;--> statement-breakpoint
ALTER TABLE "Thread" ADD COLUMN "mergedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Thread" ADD COLUMN "mergedById" text;--> statement-breakpoint
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_mergedIntoThreadId_Thread_id_fk" FOREIGN KEY ("mergedIntoThreadId") REFERENCES "public"."Thread"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_mergedById_User_id_fk" FOREIGN KEY ("mergedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Thread_org_active_lastMessage_idx" ON "Thread" USING btree ("organizationId","lastMessageAt" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "mergedIntoThreadId" IS NULL;