-- ============================================
-- Part 1: Add latestMessageId column
-- ============================================

ALTER TABLE "Thread" ADD COLUMN "latestMessageId" text;--> statement-breakpoint

ALTER TABLE "Thread" ADD CONSTRAINT "Thread_latestMessageId_Message_id_fk" FOREIGN KEY ("latestMessageId") REFERENCES "public"."Message"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint

-- Backfill latestMessageId from messages
UPDATE "Thread" t
SET "latestMessageId" = (
  SELECT m.id
  FROM "Message" m
  WHERE m."threadId" = t.id
    AND m."draftMode" = 'NONE'
  ORDER BY m."receivedAt" DESC NULLS LAST,
           m."sentAt" DESC NULLS LAST,
           m.id DESC
  LIMIT 1
);--> statement-breakpoint

-- ============================================
-- Part 2: Add latestCommentId column
-- ============================================

ALTER TABLE "Thread" ADD COLUMN "latestCommentId" text;--> statement-breakpoint

ALTER TABLE "Thread" ADD CONSTRAINT "Thread_latestCommentId_Comment_id_fk" FOREIGN KEY ("latestCommentId") REFERENCES "public"."Comment"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint

-- Backfill latestCommentId from comments (thread comments only, exclude deleted)
UPDATE "Thread" t
SET "latestCommentId" = (
  SELECT c.id
  FROM "Comment" c
  WHERE c."entityId" = t.id
    AND c."entityDefinitionId" = 'thread'
    AND c."deletedAt" IS NULL
  ORDER BY c."createdAt" DESC,
           c.id DESC
  LIMIT 1
);--> statement-breakpoint

-- ============================================
-- Part 3: Add inboxId column
-- ============================================

ALTER TABLE "Thread" ADD COLUMN "inboxId" text;--> statement-breakpoint

ALTER TABLE "Thread" ADD CONSTRAINT "Thread_inboxId_Inbox_id_fk" FOREIGN KEY ("inboxId") REFERENCES "public"."Inbox"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint

-- Backfill inboxId from InboxIntegration junction table
UPDATE "Thread" t
SET "inboxId" = (
  SELECT ii."inboxId"
  FROM "InboxIntegration" ii
  WHERE ii."integrationId" = t."integrationId"
  LIMIT 1
);--> statement-breakpoint

CREATE INDEX "Thread_inboxId_idx" ON "Thread" USING btree ("inboxId");--> statement-breakpoint

-- ============================================
-- Part 4: Trigger for auto-setting inboxId on INSERT
-- ============================================

CREATE OR REPLACE FUNCTION set_thread_inbox_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."inboxId" IS NULL THEN
    NEW."inboxId" := (
      SELECT "inboxId" FROM "InboxIntegration"
      WHERE "integrationId" = NEW."integrationId"
      LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER thread_set_inbox_id
  BEFORE INSERT ON "Thread"
  FOR EACH ROW
  EXECUTE FUNCTION set_thread_inbox_id();
