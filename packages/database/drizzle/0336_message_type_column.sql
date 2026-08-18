-- message-type-overhaul plan §2.7/§3, Phase 2 — `Message.messageType` becomes a
-- stored, NOT NULL column with NO default. From here on ingest always stamps it
-- explicitly; `getMessageTypeFromProvider` (providers/type-utils.ts) demotes
-- from authority to default.
--
-- Self-sufficient and idempotent (feedback_migrations_self_sufficient): the
-- backfill is INLINE, between ADD COLUMN and DROP DEFAULT, so this file never
-- depends on a runtime DataMigration running between two schema migrations.
-- The temporary default exists ONLY so step 1 succeeds against existing rows —
-- it is dropped in step 3, matching the schema file, which declares no default
-- (ingest is required to supply the value, and the Drizzle insert type now
-- enforces that at compile time).
--
-- The backfill mirrors `getMessageTypeFromProvider` EXACTLY:
--   google | outlook | mailgun | email | imap | shopify -> EMAIL
--   facebook | instagram | whatsapp | chat               -> CHAT
--   openphone | sms                                       -> SMS
--   anything else (defensive; mirrors the function's `|| EMAIL` fallback)
--                                                          -> EMAIL
-- The join deliberately does NOT filter `Integration.deletedAt` — a
-- soft-deleted integration's historical messages still need a value, and
-- disconnect never deletes the Integration row.

-- 1. ADD COLUMN with a temporary default so existing rows accept the NOT NULL.
ALTER TABLE "Message" ADD COLUMN "messageType" "MessageType" DEFAULT 'EMAIL' NOT NULL;--> statement-breakpoint

-- 2. INLINE BACKFILL, joined through Integration.
UPDATE "Message" m SET "messageType" = CASE i."provider"
  WHEN 'openphone' THEN 'SMS'::"MessageType"
  WHEN 'sms' THEN 'SMS'::"MessageType"
  WHEN 'chat' THEN 'CHAT'::"MessageType"
  WHEN 'facebook' THEN 'CHAT'::"MessageType"
  WHEN 'instagram' THEN 'CHAT'::"MessageType"
  WHEN 'whatsapp' THEN 'CHAT'::"MessageType"
  ELSE 'EMAIL'::"MessageType"
END
FROM "Integration" i
WHERE m."integrationId" = i."id";--> statement-breakpoint

-- 3. DROP DEFAULT — matches the schema file exactly (`messageType().notNull()`,
--    no `.default()`), so `tsc` catches any insert site that forgets to stamp it.
ALTER TABLE "Message" ALTER COLUMN "messageType" DROP DEFAULT;
