CREATE TABLE "ThreadEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"threadId" text NOT NULL,
	"type" text NOT NULL,
	"actorId" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ThreadEvent" ADD CONSTRAINT "ThreadEvent_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ThreadEvent" ADD CONSTRAINT "ThreadEvent_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ThreadEvent_thread_idx" ON "ThreadEvent" USING btree ("threadId","createdAt");--> statement-breakpoint
CREATE INDEX "ThreadEvent_org_type_idx" ON "ThreadEvent" USING btree ("organizationId","type","createdAt" DESC NULLS FIRST);