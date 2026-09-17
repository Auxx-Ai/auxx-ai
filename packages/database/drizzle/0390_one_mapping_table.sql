ALTER TABLE "FinancialSourceAccount" DROP CONSTRAINT "FinancialSourceAccount_axis_check";--> statement-breakpoint
ALTER TABLE "PaymentRoute" DROP CONSTRAINT "PaymentRoute_shape_check";--> statement-breakpoint
ALTER TABLE "PaymentRoute" DROP CONSTRAINT "PaymentRoute_processorAccountId_fk";
--> statement-breakpoint
ALTER TABLE "PaymentRoute" DROP CONSTRAINT "PaymentRoute_paymentGatewayInstanceId_fk";
--> statement-breakpoint
DROP INDEX "PaymentRoute_processor_key";--> statement-breakpoint
DROP INDEX "GlRoleAssignment_org_role_default_key";--> statement-breakpoint
ALTER TABLE "FinancialSourceAccount" ADD COLUMN "paymentGatewayId" text;--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD COLUMN "paymentGatewayId" text;--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "FinancialSourceAccount" ADD CONSTRAINT "FinancialSourceAccount_paymentGatewayId_fk" FOREIGN KEY ("organizationId","paymentGatewayId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD CONSTRAINT "GlRoleAssignment_paymentGatewayId_fk" FOREIGN KEY ("organizationId","paymentGatewayId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "GlRoleAssignment_org_role_default_key" ON "GlRoleAssignment" USING btree ("organizationId","role") WHERE "GlRoleAssignment"."sourceAccountId" IS NULL AND "GlRoleAssignment"."paymentGatewayId" IS NULL;--> statement-breakpoint
ALTER TABLE "FinancialSourceAccount" DROP COLUMN "axis";--> statement-breakpoint
ALTER TABLE "PaymentRoute" DROP COLUMN "processorAccountId";--> statement-breakpoint
ALTER TABLE "PaymentRoute" DROP COLUMN "paymentGatewayInstanceId";--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD CONSTRAINT "GlRoleAssignment_scope_exclusive_check" CHECK (num_nonnulls("GlRoleAssignment"."sourceAccountId", "GlRoleAssignment"."paymentGatewayId") <= 1);--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD CONSTRAINT "GlRoleAssignment_currency_rail_check" CHECK ("GlRoleAssignment"."currency" IS NULL OR "GlRoleAssignment"."paymentGatewayId" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD CONSTRAINT "GlRoleAssignment_currency_format_check" CHECK ("GlRoleAssignment"."currency" IS NULL OR "GlRoleAssignment"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
-- 58 D5 retires the processor kind. The rows go before the check that would
-- refuse them: dev has none, production is unmeasured, and a surviving row
-- fails this statement on deploy.
DELETE FROM "PaymentRoute" WHERE "kind" = 'processor';--> statement-breakpoint
ALTER TABLE "PaymentRoute" ADD CONSTRAINT "PaymentRoute_shape_check" CHECK ("PaymentRoute"."kind" = 'manual' AND num_nonnulls("PaymentRoute"."bankAccountInstanceId", "PaymentRoute"."cashGlAccountInstanceId") = 1);--> statement-breakpoint
-- 58 §4.8 step 1: `clearing_card` is renamed `clearing` (D6). First, because
-- steps 2-5 below read and write the post-rename vocabulary.
UPDATE "GlRoleAssignment" SET "role" = 'clearing' WHERE "role" = 'clearing_card';--> statement-breakpoint
UPDATE "GlPostingLine" SET "accountRole" = 'clearing' WHERE "accountRole" = 'clearing_card';--> statement-breakpoint
-- 58 §4.8 step 2: mint scoped `GlRoleAssignment` rows from the `payment_gateway`
-- registry's clearingAccount / feeAccount / settlementBankAccount fields, which
-- entity migration 167 (U7, not this migration) removes once every reader has
-- moved off them. `EntityDefinition.entityType`, not `apiSlug`, is the per-org
-- key for a system resource (`loadExistingState` in seed/entity-helpers.ts).
--
-- Clearing: skipped when the gateway's clearing account is already the org's
-- `clearing` default (58 §4.8 step 2) — that gateway needs no override, it
-- already resolves correctly through the unscoped fallback.
INSERT INTO "GlRoleAssignment"
  ("id", "organizationId", "role", "glAccountId", "paymentGatewayId", "source")
-- `DISTINCT ON` because `FieldValue` is unique on (entityId, fieldId, sortKey):
-- a stray second row would insert twice and fail the rail index built below.
SELECT DISTINCT ON (ei."id")
  'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 23),
  ei."organizationId", 'clearing', fv."valueText", ei."id", 'seed'
FROM "EntityInstance" ei
JOIN "EntityDefinition" ed
  ON ed."id" = ei."entityDefinitionId" AND ed."entityType" = 'payment_gateway'
JOIN "CustomField" cf
  ON cf."entityDefinitionId" = ed."id"
 AND cf."organizationId" = ei."organizationId"
 AND cf."systemAttribute" = 'payment_gateway_clearing_account'
JOIN "FieldValue" fv
  ON fv."entityId" = ei."id" AND fv."fieldId" = cf."id"
LEFT JOIN "GlRoleAssignment" org_default
  ON org_default."organizationId" = ei."organizationId"
 AND org_default."role" = 'clearing'
 AND org_default."sourceAccountId" IS NULL
 AND org_default."paymentGatewayId" IS NULL
WHERE fv."valueText" IS NOT NULL
  AND fv."valueText" <> ''
  AND (org_default."glAccountId" IS NULL OR fv."valueText" <> org_default."glAccountId")
ORDER BY ei."id", fv."sortKey";--> statement-breakpoint
-- Fees: no default-account exemption named in §4.8 step 2, so every gateway
-- that names a fee account gets its own row.
INSERT INTO "GlRoleAssignment"
  ("id", "organizationId", "role", "glAccountId", "paymentGatewayId", "source")
SELECT DISTINCT ON (ei."id")
  'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 23),
  ei."organizationId", 'payment_processing_fees', fv."valueText", ei."id", 'seed'
FROM "EntityInstance" ei
JOIN "EntityDefinition" ed
  ON ed."id" = ei."entityDefinitionId" AND ed."entityType" = 'payment_gateway'
JOIN "CustomField" cf
  ON cf."entityDefinitionId" = ed."id"
 AND cf."organizationId" = ei."organizationId"
 AND cf."systemAttribute" = 'payment_gateway_fee_account'
JOIN "FieldValue" fv
  ON fv."entityId" = ei."id" AND fv."fieldId" = cf."id"
WHERE fv."valueText" IS NOT NULL AND fv."valueText" <> ''
ORDER BY ei."id", fv."sortKey";--> statement-breakpoint
-- Bank: `settlementBankAccount` is a RELATIONSHIP field (value in
-- `relatedEntityId`, a `bank_account` EntityInstance), so the role's account is
-- one hop further, off that bank account's own `glAccount` text field.
INSERT INTO "GlRoleAssignment"
  ("id", "organizationId", "role", "glAccountId", "paymentGatewayId", "source")
SELECT DISTINCT ON (ei."id")
  'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 23),
  ei."organizationId", 'bank', bank_fv."valueText", ei."id", 'seed'
FROM "EntityInstance" ei
JOIN "EntityDefinition" ed
  ON ed."id" = ei."entityDefinitionId" AND ed."entityType" = 'payment_gateway'
JOIN "CustomField" cf
  ON cf."entityDefinitionId" = ed."id"
 AND cf."organizationId" = ei."organizationId"
 AND cf."systemAttribute" = 'payment_gateway_settlement_bank_account'
JOIN "FieldValue" fv
  ON fv."entityId" = ei."id" AND fv."fieldId" = cf."id"
JOIN "EntityDefinition" bank_ed
  ON bank_ed."entityType" = 'bank_account' AND bank_ed."organizationId" = ei."organizationId"
JOIN "CustomField" bank_cf
  ON bank_cf."entityDefinitionId" = bank_ed."id"
 AND bank_cf."organizationId" = ei."organizationId"
 AND bank_cf."systemAttribute" = 'bank_account_gl_account'
JOIN "FieldValue" bank_fv
  ON bank_fv."entityId" = fv."relatedEntityId" AND bank_fv."fieldId" = bank_cf."id"
WHERE fv."relatedEntityId" IS NOT NULL
  AND bank_fv."valueText" IS NOT NULL
  AND bank_fv."valueText" <> ''
ORDER BY ei."id", fv."sortKey";--> statement-breakpoint
-- Built after the inserts above, not with the rest of the DDL: an existing bad
-- row would otherwise fail the index build before step 2 ever ran (58 §4.8).
CREATE UNIQUE INDEX "GlRoleAssignment_org_role_rail_key" ON "GlRoleAssignment" USING btree ("organizationId","role","paymentGatewayId",coalesce("currency", '')) WHERE "GlRoleAssignment"."paymentGatewayId" IS NOT NULL;--> statement-breakpoint
-- 58 §4.8 step 3: the `settlementAccount` text field named a
-- `FinancialSourceAccount` id directly; carry it onto the new column, only
-- where that row still exists and is live.
UPDATE "FinancialSourceAccount" fsa
SET "paymentGatewayId" = ei."id"
FROM "EntityInstance" ei
JOIN "EntityDefinition" ed
  ON ed."id" = ei."entityDefinitionId" AND ed."entityType" = 'payment_gateway'
JOIN "CustomField" cf
  ON cf."entityDefinitionId" = ed."id"
 AND cf."organizationId" = ei."organizationId"
 AND cf."systemAttribute" = 'payment_gateway_settlement_account'
JOIN "FieldValue" fv
  ON fv."entityId" = ei."id" AND fv."fieldId" = cf."id"
WHERE fsa."id" = fv."valueText"
  AND fsa."organizationId" = ei."organizationId"
  AND fsa."archivedAt" IS NULL;--> statement-breakpoint
-- 58 §4.8 step 4: the processor-axis `payment_processing_fees` rows (scoped by
-- `sourceAccountId`) are retired by the rail scope above.
DELETE FROM "GlRoleAssignment"
WHERE "role" = 'payment_processing_fees' AND "sourceAccountId" IS NOT NULL;--> statement-breakpoint
-- 58 §4.8 step 5: rows whose role left the vocabulary (`clearing_affirm`,
-- `equity_opening_balance` on dev) are invisible to `resolveRoles` and wrong on
-- the checklist. `bank` is included: step 2 above just minted rows with it.
DELETE FROM "GlRoleAssignment"
WHERE "role" NOT IN (
  'inventory_raw_materials', 'inventory_wip', 'inventory_finished_goods',
  'accounts_payable', 'payroll_clearing', 'freight_accrual', 'grni',
  'duties_accrual', 'cogs_product_cost', 'applied_overhead', 'ppv',
  'inventory_count_variance', 'accounts_receivable', 'undeposited_funds',
  'clearing', 'bank', 'unidentified_receipts', 'sales_tax_payable',
  'customer_deposits', 'equity_retained_earnings', 'revenue_product',
  'revenue_shipping', 'revenue_service', 'revenue_returns_allowances',
  'payment_processing_fees', 'bad_debt_expense'
);
