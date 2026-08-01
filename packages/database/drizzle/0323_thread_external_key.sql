CREATE TABLE "ThreadExternalKey" (
	"id" text PRIMARY KEY NOT NULL,
	"threadId" text NOT NULL,
	"integrationId" text NOT NULL,
	"externalId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ThreadExternalKey" ADD CONSTRAINT "ThreadExternalKey_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ThreadExternalKey" ADD CONSTRAINT "ThreadExternalKey_integrationId_Integration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."Integration"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ThreadExternalKey_integrationId_externalId_key" ON "ThreadExternalKey" USING btree ("integrationId","externalId");--> statement-breakpoint
CREATE INDEX "ThreadExternalKey_threadId_idx" ON "ThreadExternalKey" USING btree ("threadId");--> statement-breakpoint
-- Backfill: seed one alias per existing thread that already has a provider key, so
-- the alias table is authoritative from the first message ingested after this runs.
-- Inlined here on purpose — the schema migration has to stand on its own rather
-- than depend on a runtime DataMigration landing afterwards.
--
-- `Thread."externalId"` is nullable (placeholder threads carry none), so it is
-- filtered out; `Thread."integrationId"` is NOT NULL and needs no guard.
-- ON CONFLICT DO NOTHING is belt-and-braces: `Thread_integrationId_externalId_key`
-- is a unique index over a nullable column, and NULLs never conflicted there.
INSERT INTO "ThreadExternalKey" ("id", "threadId", "integrationId", "externalId")
SELECT gen_random_uuid()::text, t."id", t."integrationId", t."externalId"
FROM "Thread" t
WHERE t."externalId" IS NOT NULL
ON CONFLICT DO NOTHING;