CREATE TYPE "public"."ThreadSentiment" AS ENUM('NEGATIVE', 'NEUTRAL', 'POSITIVE');--> statement-breakpoint
ALTER TABLE "Thread" ADD COLUMN "priority" "TicketPriority";--> statement-breakpoint
ALTER TABLE "Thread" ADD COLUMN "needsReply" boolean;--> statement-breakpoint
ALTER TABLE "Thread" ADD COLUMN "sentiment" "ThreadSentiment";--> statement-breakpoint
ALTER TABLE "Thread" ADD COLUMN "spamScore" real;