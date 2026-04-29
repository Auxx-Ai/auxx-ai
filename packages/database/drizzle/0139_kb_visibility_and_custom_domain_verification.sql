CREATE TYPE "public"."KBVisibility" AS ENUM('PUBLIC', 'INTERNAL');--> statement-breakpoint
ALTER TABLE "KnowledgeBase" ADD COLUMN "visibility" "KBVisibility" DEFAULT 'PUBLIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "KnowledgeBase" ADD COLUMN "customDomainVerifiedAt" timestamp (3);