CREATE TYPE "public"."KBKind" AS ENUM('standard', 'source');--> statement-breakpoint
ALTER TABLE "KnowledgeSource" DROP CONSTRAINT "KnowledgeSource_targetKnowledgeBaseId_KnowledgeBase_id_fk";
--> statement-breakpoint
DROP INDEX "KnowledgeSource_targetKnowledgeBaseId_idx";--> statement-breakpoint
ALTER TABLE "KnowledgeBase" ADD COLUMN "kind" "KBKind" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "KnowledgeSource" ADD COLUMN "ownedKnowledgeBaseId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_ownedKnowledgeBaseId_KnowledgeBase_id_fk" FOREIGN KEY ("ownedKnowledgeBaseId") REFERENCES "public"."KnowledgeBase"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "KnowledgeSource_ownedKnowledgeBaseId_idx" ON "KnowledgeSource" USING btree ("ownedKnowledgeBaseId");--> statement-breakpoint
ALTER TABLE "KnowledgeSource" DROP COLUMN "targetKnowledgeBaseId";