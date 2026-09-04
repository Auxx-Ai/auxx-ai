ALTER TABLE "PaymentTransaction" ADD COLUMN "bankTransactionId" text;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD COLUMN "bankClearedAt" timestamp (3);--> statement-breakpoint
CREATE INDEX "PaymentTransaction_organizationId_bankTransactionId_idx" ON "PaymentTransaction" USING btree ("organizationId","bankTransactionId");--> statement-breakpoint
-- Backfill (plans/accounting/HANDOFF.md 5b, departure 2). The bank review queue
-- had no typed home for "which bank line confirmed this payment", so it stamped
-- `metadata.bankTransactionId` / `metadata.bankClearedAt` /
-- `metadata.confirmationSource`. Those three move into the columns above and
-- come OUT of the blob in this migration, because a migration has to be
-- self-sufficient: leaving the strip to a later DataMigration would mean every
-- row carried the fact twice, in two places free to disagree, for as long as it
-- took that migration to run.
--
-- `metadata.date` is deliberately untouched. It is the user-picked accounting
-- date that `postPaymentTransaction` and the candidate reader both depend on,
-- and it is not part of this move.
UPDATE "PaymentTransaction"
SET "bankTransactionId" = "metadata" ->> 'bankTransactionId'
WHERE "metadata" ? 'bankTransactionId'
  AND "metadata" ->> 'bankTransactionId' IS NOT NULL
  AND "bankTransactionId" IS NULL;--> statement-breakpoint
-- The timestamp was written as an ISO string by `stampDocument`. A row whose
-- value will not parse keeps its pointer and loses only the cleared date, which
-- is the harmless half: `bankTransactionId IS NOT NULL` is what every read asks.
UPDATE "PaymentTransaction"
SET "bankClearedAt" = ("metadata" ->> 'bankClearedAt')::timestamp(3)
WHERE "metadata" ? 'bankClearedAt'
  AND "metadata" ->> 'bankClearedAt' ~ '^\d{4}-\d{2}-\d{2}[T ]'
  AND "bankClearedAt" IS NULL;--> statement-breakpoint
-- 🛑 The strip runs LAST and only over rows that were actually carrying one of
-- the three keys, so it can never rewrite a blob it had no reason to touch.
-- `confirmationSource` gets no column: `bankTransactionId IS NOT NULL` is the
-- same statement, and a second column saying so is a second thing that can
-- disagree with the first.
UPDATE "PaymentTransaction"
SET "metadata" = "metadata" - 'bankTransactionId' - 'bankClearedAt' - 'confirmationSource'
WHERE "metadata" ?| ARRAY['bankTransactionId', 'bankClearedAt', 'confirmationSource'];
