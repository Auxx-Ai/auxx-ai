ALTER TYPE "public"."ContactFieldType" ADD VALUE 'ACTOR';--> statement-breakpoint
ALTER TABLE "EntityGroupPermission" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "EntityGroupPermission" CASCADE;--> statement-breakpoint
ALTER TABLE "FieldValue" ADD COLUMN "actorId" text;--> statement-breakpoint
ALTER TABLE "FieldValue" ADD CONSTRAINT "FieldValue_actorId_User_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "FieldValue_actorId_idx" ON "FieldValue" USING btree ("actorId");