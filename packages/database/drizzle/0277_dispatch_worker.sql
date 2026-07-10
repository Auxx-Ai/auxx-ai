CREATE TABLE "DispatchWorker" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"color" text,
	"homeBase" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "WorkOrderVisit" ADD COLUMN "dispatchedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "DispatchWorker" ADD CONSTRAINT "DispatchWorker_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DispatchWorker" ADD CONSTRAINT "DispatchWorker_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "DispatchWorker_organizationId_userId_key" ON "DispatchWorker" USING btree ("organizationId","userId");