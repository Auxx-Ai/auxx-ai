ALTER TABLE "UsageEvent" ADD COLUMN "eventId" text;--> statement-breakpoint
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_eventId_unique" UNIQUE("eventId");