ALTER TABLE "EmailAttachment" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "EmailAttachment" CASCADE;--> statement-breakpoint
ALTER TABLE "Attachment" ADD COLUMN "contentId" text;--> statement-breakpoint
ALTER TABLE "Message" ADD COLUMN "htmlBodyStorageLocationId" text;--> statement-breakpoint
ALTER TABLE "Message" ADD CONSTRAINT "Message_htmlBodyStorageLocationId_StorageLocation_id_fk" FOREIGN KEY ("htmlBodyStorageLocationId") REFERENCES "public"."StorageLocation"("id") ON DELETE set null ON UPDATE cascade;