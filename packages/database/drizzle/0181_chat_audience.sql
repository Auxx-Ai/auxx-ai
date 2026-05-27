CREATE TYPE "public"."ChatAudience" AS ENUM('visitors', 'both', 'users');--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "chatAudience" "ChatAudience" DEFAULT 'visitors' NOT NULL;