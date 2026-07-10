DROP INDEX "OperatingHours_widgetId_dayOfWeek_key";--> statement-breakpoint
DROP INDEX "OperatingHours_widgetId_idx";--> statement-breakpoint
ALTER TABLE "OperatingHours" ALTER COLUMN "widgetId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "OperatingHours" ALTER COLUMN "dayOfWeek" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "OperatingHours" ALTER COLUMN "startMinute" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "OperatingHours" ALTER COLUMN "endMinute" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "OperatingHours" ADD COLUMN "organizationId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "OperatingHours" ADD COLUMN "subjectType" text NOT NULL;--> statement-breakpoint
ALTER TABLE "OperatingHours" ADD COLUMN "userId" text;--> statement-breakpoint
ALTER TABLE "OperatingHours" ADD COLUMN "kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "OperatingHours" ADD COLUMN "date" date;--> statement-breakpoint
ALTER TABLE "OperatingHours" ADD COLUMN "isAvailable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "OperatingHours" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "OperatingHours" ADD CONSTRAINT "OperatingHours_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OperatingHours" ADD CONSTRAINT "OperatingHours_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "OperatingHours_organizationId_subjectType_idx" ON "OperatingHours" USING btree ("organizationId","subjectType");--> statement-breakpoint
CREATE INDEX "OperatingHours_userId_date_idx" ON "OperatingHours" USING btree ("userId","date");--> statement-breakpoint
CREATE INDEX "OperatingHours_widgetId_dayOfWeek_idx" ON "OperatingHours" USING btree ("widgetId","dayOfWeek");--> statement-breakpoint
ALTER TABLE "OperatingHours" DROP COLUMN "startHour";--> statement-breakpoint
ALTER TABLE "OperatingHours" DROP COLUMN "endHour";