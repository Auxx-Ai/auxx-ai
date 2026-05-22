CREATE TYPE "public"."ThreadHandoffState" AS ENUM('ai', 'human');--> statement-breakpoint
ALTER TABLE "Thread" ADD COLUMN "handoffState" "ThreadHandoffState" DEFAULT 'ai' NOT NULL;