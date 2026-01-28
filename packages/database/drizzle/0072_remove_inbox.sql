ALTER TYPE "public"."ContactFieldType" ADD VALUE 'JSON';--> statement-breakpoint
ALTER TABLE "InboxMemberAccess" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "Inbox" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "InboxMemberAccess" CASCADE;--> statement-breakpoint
DROP TABLE "Inbox" CASCADE;--> statement-breakpoint
DELETE FROM "InboxIntegration" WHERE "inboxId" NOT IN (SELECT "id" FROM "EntityInstance");--> statement-breakpoint
DELETE FROM "UserInboxUnreadCount" WHERE "inboxId" NOT IN (SELECT "id" FROM "EntityInstance");--> statement-breakpoint
UPDATE "Thread" SET "inboxId" = NULL WHERE "inboxId" IS NOT NULL AND "inboxId" NOT IN (SELECT "id" FROM "EntityInstance");--> statement-breakpoint
ALTER TABLE "InboxIntegration" ADD CONSTRAINT "InboxIntegration_inboxId_EntityInstance_id_fk" FOREIGN KEY ("inboxId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "UserInboxUnreadCount" ADD CONSTRAINT "UserInboxUnreadCount_inboxId_EntityInstance_id_fk" FOREIGN KEY ("inboxId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_inboxId_EntityInstance_id_fk" FOREIGN KEY ("inboxId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;