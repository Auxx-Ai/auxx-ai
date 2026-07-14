ALTER TABLE "WorkOrderVisit" ADD COLUMN "timeConfirmedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" ADD COLUMN "durationMinutes" integer;