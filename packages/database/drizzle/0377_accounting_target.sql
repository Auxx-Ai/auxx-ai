CREATE TYPE "public"."ProviderLedgerAuthor" AS ENUM('auxx', 'provider');--> statement-breakpoint
ALTER TYPE "public"."GlPostingStatus" ADD VALUE 'draft' BEFORE 'posted';--> statement-breakpoint
CREATE TABLE "ExportBatch" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"bookId" text NOT NULL,
	"connectionId" text NOT NULL,
	"mode" text NOT NULL,
	"avenue" text NOT NULL,
	"grainKey" text NOT NULL,
	"storeId" text,
	"railId" text,
	"currency" text NOT NULL,
	"objectType" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payloadHash" text NOT NULL,
	"state" text DEFAULT 'ready' NOT NULL,
	"providerObjectId" text,
	"providerSyncToken" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone,
	"leaseToken" text,
	"leaseExpiresAt" timestamp with time zone,
	"lastError" text,
	"totalMinor" bigint DEFAULT 0 NOT NULL,
	"sentAt" timestamp with time zone,
	"withdrawnAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ExportBatch_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "ExportBatch_state_check" CHECK ("ExportBatch"."state" IN ('ready','sending','sent','failed','withdrawn') AND "ExportBatch"."mode" IN ('transaction','summary') AND "ExportBatch"."attempts" >= 0),
	CONSTRAINT "ExportBatch_payloadHash_check" CHECK ("ExportBatch"."payloadHash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "ExportBatchPosting" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"batchId" text NOT NULL,
	"glPostingId" text NOT NULL,
	"withdrawnAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ExternalAccountingBook" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"providerKey" text NOT NULL,
	"externalCompanyId" text NOT NULL,
	CONSTRAINT "ExternalAccountingBook_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "ExternalAccountingBook_company_key" UNIQUE("organizationId","providerKey","externalCompanyId"),
	CONSTRAINT "ExternalAccountingBook_identity_check" CHECK (length("ExternalAccountingBook"."providerKey") > 0 AND length("ExternalAccountingBook"."externalCompanyId") > 0)
);
--> statement-breakpoint
CREATE TABLE "ExternalBookConnection" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"bookId" text NOT NULL,
	"epoch" integer NOT NULL,
	"credentialId" text,
	"credentialOrganizationId" text,
	"credentialBindingSnapshot" text NOT NULL,
	"state" text NOT NULL,
	"exportFromDate" date NOT NULL,
	"openingPolicy" jsonb NOT NULL,
	CONSTRAINT "ExternalBookConnection_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "ExternalBookConnection_epoch_key" UNIQUE("organizationId","bookId","epoch"),
	CONSTRAINT "ExternalBookConnection_credential_check" CHECK (("ExternalBookConnection"."credentialId" IS NULL AND "ExternalBookConnection"."credentialOrganizationId" IS NULL) OR ("ExternalBookConnection"."credentialId" IS NOT NULL AND "ExternalBookConnection"."credentialOrganizationId" IS NOT NULL AND "ExternalBookConnection"."credentialOrganizationId" = "ExternalBookConnection"."organizationId")),
	CONSTRAINT "ExternalBookConnection_state_check" CHECK ("ExternalBookConnection"."state" IN ('active', 'disconnected', 'retired') AND "ExternalBookConnection"."epoch" > 0)
);
--> statement-breakpoint
CREATE TABLE "FinancialSourceAcceptance" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sourceObjectId" text NOT NULL,
	"observationId" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"orderExternalId" text NOT NULL,
	"orderInstanceId" text,
	"moneyTransactionId" text,
	"unresolvedReferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "FinancialSourceAcceptance_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "FinancialSourceAcceptance_object_key" UNIQUE("organizationId","sourceObjectId"),
	CONSTRAINT "FinancialSourceAcceptance_state_check" CHECK ("FinancialSourceAcceptance"."state" IN ('pending','accepted','rejected','blocked') AND "FinancialSourceAcceptance"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "FinancialSourceAccount" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"providerKey" text NOT NULL,
	"externalAccountId" text NOT NULL,
	"environment" text NOT NULL,
	"archivedAt" timestamp with time zone,
	"name" text,
	"paymentGatewayId" text,
	CONSTRAINT "FinancialSourceAccount_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "FinancialSourceAccount_identity_key" UNIQUE("organizationId","providerKey","externalAccountId","environment"),
	CONSTRAINT "FinancialSourceAccount_identity_check" CHECK (length("FinancialSourceAccount"."providerKey") > 0 AND length("FinancialSourceAccount"."externalAccountId") > 0 AND "FinancialSourceAccount"."environment" IN ('live', 'test'))
);
--> statement-breakpoint
CREATE TABLE "FinancialSourceCoverage" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sourceAccountId" text NOT NULL,
	"streamKey" text NOT NULL,
	"windowKey" text NOT NULL,
	"requestedBoundary" jsonb NOT NULL,
	"fetchedBoundary" jsonb NOT NULL,
	"fetchedCount" integer NOT NULL,
	"acceptedCount" integer NOT NULL,
	"rejectedCount" integer NOT NULL,
	"pendingCount" integer NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "FinancialSourceCoverage_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "FinancialSourceCoverage_window_key" UNIQUE("organizationId","sourceAccountId","streamKey","windowKey"),
	CONSTRAINT "FinancialSourceCoverage_counts_check" CHECK ("FinancialSourceCoverage"."fetchedCount" >= 0 AND "FinancialSourceCoverage"."acceptedCount" >= 0 AND "FinancialSourceCoverage"."rejectedCount" >= 0 AND "FinancialSourceCoverage"."pendingCount" >= 0 AND "FinancialSourceCoverage"."acceptedCount" + "FinancialSourceCoverage"."rejectedCount" + "FinancialSourceCoverage"."pendingCount" = "FinancialSourceCoverage"."fetchedCount" AND (NOT "FinancialSourceCoverage"."complete" OR ("FinancialSourceCoverage"."pendingCount" = 0 AND "FinancialSourceCoverage"."rejectedCount" = 0)))
);
--> statement-breakpoint
CREATE TABLE "FinancialSourceObject" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sourceAccountId" text NOT NULL,
	"objectType" text NOT NULL,
	"externalId" text NOT NULL,
	"componentKey" text DEFAULT '' NOT NULL,
	CONSTRAINT "FinancialSourceObject_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "FinancialSourceObject_identity_key" UNIQUE("organizationId","sourceAccountId","objectType","externalId","componentKey")
);
--> statement-breakpoint
CREATE TABLE "FinancialSourceObservation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sourceObjectId" text NOT NULL,
	"contentHash" text NOT NULL,
	"providerVersion" text,
	"observedAt" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"reportingInstallationSnapshot" jsonb NOT NULL,
	CONSTRAINT "FinancialSourceObservation_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "FinancialSourceObservation_hash_key" UNIQUE("organizationId","sourceObjectId","contentHash")
);
--> statement-breakpoint
CREATE TABLE "GlPostingSource" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"glPostingId" text NOT NULL,
	"sourceKind" text NOT NULL,
	"sourceId" text NOT NULL,
	"linkRole" text NOT NULL,
	"occurrence" text DEFAULT 'original' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "MoneyApplication" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"moneyTransactionId" text NOT NULL,
	"operation" text NOT NULL,
	"amountMinor" bigint NOT NULL,
	"orderInstanceId" text,
	"invoiceInstanceId" text,
	"vendorBillInstanceId" text,
	"quoteInstanceId" text,
	"appliedAt" timestamp with time zone NOT NULL,
	"effectiveDate" date NOT NULL,
	"reversesApplicationId" text,
	"commandId" text NOT NULL,
	"commandItemKey" text NOT NULL,
	CONSTRAINT "MoneyApplication_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "MoneyApplication_command_key" UNIQUE("organizationId","commandId","commandItemKey"),
	CONSTRAINT "MoneyApplication_shape_check" CHECK ("MoneyApplication"."amountMinor" > 0 AND num_nonnulls("MoneyApplication"."orderInstanceId", "MoneyApplication"."invoiceInstanceId", "MoneyApplication"."vendorBillInstanceId") = 1 AND (("MoneyApplication"."operation" = 'apply' AND "MoneyApplication"."reversesApplicationId" IS NULL) OR ("MoneyApplication"."operation" = 'unapply' AND "MoneyApplication"."reversesApplicationId" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "MoneyCommand" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"commandKey" text NOT NULL,
	"kind" text NOT NULL,
	"payloadHash" text NOT NULL,
	"actorSnapshot" jsonb NOT NULL,
	"resultIds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "MoneyCommand_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "MoneyCommand_key" UNIQUE("organizationId","commandKey")
);
--> statement-breakpoint
CREATE TABLE "MoneyRefundSettlement" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"refundTransactionId" text NOT NULL,
	"originalTransactionId" text,
	"amountMinor" bigint NOT NULL,
	"disposition" text NOT NULL,
	"customerCreditMemoInstanceId" text,
	"vendorCreditInstanceId" text,
	"unappliedMoneyTransactionId" text,
	"commandId" text NOT NULL,
	"commandItemKey" text NOT NULL,
	CONSTRAINT "MoneyRefundSettlement_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "MoneyRefundSettlement_command_key" UNIQUE("organizationId","commandId","commandItemKey"),
	CONSTRAINT "MoneyRefundSettlement_shape_check" CHECK ("MoneyRefundSettlement"."amountMinor" > 0 AND (("MoneyRefundSettlement"."disposition" = 'customer_credit' AND "MoneyRefundSettlement"."customerCreditMemoInstanceId" IS NOT NULL AND "MoneyRefundSettlement"."vendorCreditInstanceId" IS NULL AND "MoneyRefundSettlement"."unappliedMoneyTransactionId" IS NULL) OR ("MoneyRefundSettlement"."disposition" = 'vendor_credit' AND "MoneyRefundSettlement"."customerCreditMemoInstanceId" IS NULL AND "MoneyRefundSettlement"."vendorCreditInstanceId" IS NOT NULL AND "MoneyRefundSettlement"."unappliedMoneyTransactionId" IS NULL) OR ("MoneyRefundSettlement"."disposition" = 'unapplied_money' AND "MoneyRefundSettlement"."customerCreditMemoInstanceId" IS NULL AND "MoneyRefundSettlement"."vendorCreditInstanceId" IS NULL AND "MoneyRefundSettlement"."unappliedMoneyTransactionId" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "MoneySourceLink" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sourceObjectId" text NOT NULL,
	"moneyTransactionId" text NOT NULL,
	"verifiedByCommandId" text NOT NULL,
	"linkedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "MoneySourceLink_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "MoneySourceLink_object_key" UNIQUE("organizationId","sourceObjectId")
);
--> statement-breakpoint
CREATE TABLE "MoneyTransaction" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"purpose" text NOT NULL,
	"amountMinor" bigint NOT NULL,
	"currency" text NOT NULL,
	"currencyExponent" integer NOT NULL,
	"datePrecision" text NOT NULL,
	"occurredAt" timestamp with time zone,
	"occurredOn" date,
	"partyInstanceId" text,
	"cashAccountInstanceId" text,
	"method" text,
	"recordedByCommandId" text NOT NULL,
	"reference" text,
	"note" text,
	"quoteInstanceId" text,
	"workOrderInstanceId" text,
	"bankDepositInstanceId" text,
	CONSTRAINT "MoneyTransaction_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "MoneyTransaction_money_check" CHECK ("MoneyTransaction"."amountMinor" > 0 AND "MoneyTransaction"."currency" ~ '^[A-Z]{3}$' AND "MoneyTransaction"."currencyExponent" BETWEEN 0 AND 4 AND "MoneyTransaction"."purpose" IN ('customer_receipt','customer_refund','vendor_payment','vendor_refund')),
	CONSTRAINT "MoneyTransaction_date_check" CHECK (("MoneyTransaction"."datePrecision" = 'instant' AND "MoneyTransaction"."occurredAt" IS NOT NULL AND "MoneyTransaction"."occurredOn" IS NULL) OR ("MoneyTransaction"."datePrecision" = 'date' AND "MoneyTransaction"."occurredAt" IS NULL AND "MoneyTransaction"."occurredOn" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "MoneyTransfer" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sourceAccountId" text NOT NULL,
	"sourceObjectId" text NOT NULL,
	"currentObservationId" text NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"externalId" text NOT NULL,
	"status" text NOT NULL,
	"reconciliationBasisHash" text,
	"reconciliationState" text DEFAULT 'pending' NOT NULL,
	"reconciliationResult" jsonb,
	"reconciledAt" timestamp with time zone,
	"sourceAmountMinor" bigint NOT NULL,
	"sourceCurrency" text NOT NULL,
	"sourceCurrencyExponent" integer NOT NULL,
	"destinationAmountMinor" bigint NOT NULL,
	"destinationCurrency" text NOT NULL,
	"destinationCurrencyExponent" integer NOT NULL,
	"destinationBankAccountInstanceId" text,
	"destinationExternalId" text,
	"datePrecision" text NOT NULL,
	"occurredAt" timestamp with time zone,
	"occurredOn" date,
	CONSTRAINT "MoneyTransfer_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "MoneyTransfer_source_key" UNIQUE("organizationId","sourceObjectId"),
	CONSTRAINT "MoneyTransfer_currency_check" CHECK ("MoneyTransfer"."sourceCurrency" ~ '^[A-Z]{3}$' AND "MoneyTransfer"."destinationCurrency" ~ '^[A-Z]{3}$' AND "MoneyTransfer"."sourceCurrencyExponent" BETWEEN 0 AND 4 AND "MoneyTransfer"."destinationCurrencyExponent" BETWEEN 0 AND 4),
	CONSTRAINT "MoneyTransfer_date_check" CHECK (("MoneyTransfer"."datePrecision" = 'instant' AND "MoneyTransfer"."occurredAt" IS NOT NULL AND "MoneyTransfer"."occurredOn" IS NULL) OR ("MoneyTransfer"."datePrecision" = 'date' AND "MoneyTransfer"."occurredAt" IS NULL AND "MoneyTransfer"."occurredOn" IS NOT NULL) OR ("MoneyTransfer"."datePrecision" = 'unknown' AND "MoneyTransfer"."occurredAt" IS NULL AND "MoneyTransfer"."occurredOn" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ProcessorBalanceEntry" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sourceAccountId" text NOT NULL,
	"sourceObjectId" text NOT NULL,
	"currentObservationId" text NOT NULL,
	"externalId" text NOT NULL,
	"type" text NOT NULL,
	"grossMinor" bigint NOT NULL,
	"feeMinor" bigint NOT NULL,
	"netMinor" bigint NOT NULL,
	"currency" text NOT NULL,
	"currencyExponent" integer NOT NULL,
	"transactionDate" timestamp with time zone,
	"payoutExternalId" text,
	"sourceTransactionId" text,
	"sourceReference" jsonb,
	"sourceOrderId" text,
	"sourceId" text,
	"sourceType" text,
	"isOutgoingTransfer" boolean NOT NULL,
	CONSTRAINT "ProcessorBalanceEntry_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "ProcessorBalanceEntry_source_key" UNIQUE("organizationId","sourceObjectId"),
	CONSTRAINT "ProcessorBalanceEntry_currency_check" CHECK ("ProcessorBalanceEntry"."currency" ~ '^[A-Z]{3}$' AND "ProcessorBalanceEntry"."currencyExponent" BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE TABLE "ProviderLedgerEntry" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"bookId" text NOT NULL,
	"providerTxnType" text NOT NULL,
	"providerTxnId" text NOT NULL,
	"txnDate" text NOT NULL,
	"docNumber" text,
	"syncToken" text,
	"author" "ProviderLedgerAuthor" NOT NULL,
	"raw" jsonb,
	"fetchedAt" timestamp (3) DEFAULT now() NOT NULL,
	"withdrawnAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProviderLedgerLine" (
	"id" text PRIMARY KEY NOT NULL,
	"entryId" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"providerAccountName" text,
	"direction" text NOT NULL,
	"amountMinor" bigint NOT NULL,
	"providerCustomerId" text,
	"providerVendorId" text,
	"memo" text,
	"sortOrder" bigint DEFAULT 0 NOT NULL,
	"raw" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PaymentAllocation" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "PaymentAllocation" CASCADE;--> statement-breakpoint
DROP TABLE "PaymentTransaction" CASCADE;--> statement-breakpoint
ALTER TABLE "GlPosting" RENAME COLUMN "draft" TO "built";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP CONSTRAINT "GlPosting_attempts_check";--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "postingType" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."GlPostingType";--> statement-breakpoint
CREATE TYPE "public"."GlPostingType" AS ENUM('fulfillment', 'payout', 'month_end_deferral', 'month_end_reversal', 'inventory_movement', 'vendor_bill', 'manual_journal', 'opening_balance', 'bank_transaction', 'bank_deposit', 'write_off', 'payment', 'refund', 'invoice_issued', 'deposit_application', 'credit_memo', 'provider_sync', 'recurring_journal', 'expense_bill');--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "postingType" SET DATA TYPE "public"."GlPostingType" USING "postingType"::"public"."GlPostingType";--> statement-breakpoint
DROP INDEX "GlPosting_org_type_period_revision_key";--> statement-breakpoint
DROP INDEX "GlPosting_org_provider_entry_key";--> statement-breakpoint
DROP INDEX "GlPosting_org_exportStatus_idx";--> statement-breakpoint
DROP INDEX "GlRoleAssignment_org_role_key";--> statement-breakpoint
ALTER TABLE "GlPosting" ALTER COLUMN "docNumber" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "GlPosting" ADD COLUMN "storeId" text;--> statement-breakpoint
ALTER TABLE "GlPosting" ADD COLUMN "railId" text;--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD COLUMN "sourceAccountId" text;--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD COLUMN "paymentGatewayId" text;--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD COLUMN "currency" text;--> statement-breakpoint
-- Composite uniques hoisted above the foreign keys that reference them; drizzle-kit emits them after (statement order only, schema unchanged).--> statement-breakpoint
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_org_id_key" UNIQUE("organizationId","id");--> statement-breakpoint
ALTER TABLE "EntityInstance" ADD CONSTRAINT "EntityInstance_org_id_key" UNIQUE("organizationId","id");--> statement-breakpoint
ALTER TABLE "ExportBatch" ADD CONSTRAINT "ExportBatch_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExportBatch" ADD CONSTRAINT "ExportBatch_book_scope_fk" FOREIGN KEY ("organizationId","bookId") REFERENCES "public"."ExternalAccountingBook"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExportBatch" ADD CONSTRAINT "ExportBatch_connection_scope_fk" FOREIGN KEY ("organizationId","connectionId") REFERENCES "public"."ExternalBookConnection"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExportBatchPosting" ADD CONSTRAINT "ExportBatchPosting_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExportBatchPosting" ADD CONSTRAINT "ExportBatchPosting_glPostingId_GlPosting_id_fk" FOREIGN KEY ("glPostingId") REFERENCES "public"."GlPosting"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExportBatchPosting" ADD CONSTRAINT "ExportBatchPosting_batch_scope_fk" FOREIGN KEY ("organizationId","batchId") REFERENCES "public"."ExportBatch"("organizationId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExternalAccountingBook" ADD CONSTRAINT "ExternalAccountingBook_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExternalBookConnection" ADD CONSTRAINT "ExternalBookConnection_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExternalBookConnection" ADD CONSTRAINT "ExternalBookConnection_book_scope_fk" FOREIGN KEY ("organizationId","bookId") REFERENCES "public"."ExternalAccountingBook"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExternalBookConnection" ADD CONSTRAINT "ExternalBookConnection_credential_scope_fk" FOREIGN KEY ("credentialOrganizationId","credentialId") REFERENCES "public"."Credential"("organizationId","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" ADD CONSTRAINT "FinancialSourceAcceptance_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" ADD CONSTRAINT "FinancialSourceAcceptance_sourceObjectId_fk" FOREIGN KEY ("organizationId","sourceObjectId") REFERENCES "public"."FinancialSourceObject"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" ADD CONSTRAINT "FinancialSourceAcceptance_observationId_fk" FOREIGN KEY ("organizationId","observationId") REFERENCES "public"."FinancialSourceObservation"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" ADD CONSTRAINT "FinancialSourceAcceptance_orderInstanceId_fk" FOREIGN KEY ("organizationId","orderInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" ADD CONSTRAINT "FinancialSourceAcceptance_moneyTransactionId_fk" FOREIGN KEY ("organizationId","moneyTransactionId") REFERENCES "public"."MoneyTransaction"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAccount" ADD CONSTRAINT "FinancialSourceAccount_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAccount" ADD CONSTRAINT "FinancialSourceAccount_paymentGatewayId_fk" FOREIGN KEY ("organizationId","paymentGatewayId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceCoverage" ADD CONSTRAINT "FinancialSourceCoverage_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceCoverage" ADD CONSTRAINT "FinancialSourceCoverage_sourceAccountId_fk" FOREIGN KEY ("organizationId","sourceAccountId") REFERENCES "public"."FinancialSourceAccount"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceObject" ADD CONSTRAINT "FinancialSourceObject_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceObject" ADD CONSTRAINT "FinancialSourceObject_sourceAccountId_fk" FOREIGN KEY ("organizationId","sourceAccountId") REFERENCES "public"."FinancialSourceAccount"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceObservation" ADD CONSTRAINT "FinancialSourceObservation_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceObservation" ADD CONSTRAINT "FinancialSourceObservation_sourceObjectId_fk" FOREIGN KEY ("organizationId","sourceObjectId") REFERENCES "public"."FinancialSourceObject"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GlPostingSource" ADD CONSTRAINT "GlPostingSource_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GlPostingSource" ADD CONSTRAINT "GlPostingSource_glPostingId_GlPosting_id_fk" FOREIGN KEY ("glPostingId") REFERENCES "public"."GlPosting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyApplication" ADD CONSTRAINT "MoneyApplication_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyApplication" ADD CONSTRAINT "MoneyApplication_moneyTransactionId_fk" FOREIGN KEY ("organizationId","moneyTransactionId") REFERENCES "public"."MoneyTransaction"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyApplication" ADD CONSTRAINT "MoneyApplication_orderInstanceId_fk" FOREIGN KEY ("organizationId","orderInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyApplication" ADD CONSTRAINT "MoneyApplication_invoiceInstanceId_fk" FOREIGN KEY ("organizationId","invoiceInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyApplication" ADD CONSTRAINT "MoneyApplication_vendorBillInstanceId_fk" FOREIGN KEY ("organizationId","vendorBillInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyApplication" ADD CONSTRAINT "MoneyApplication_commandId_fk" FOREIGN KEY ("organizationId","commandId") REFERENCES "public"."MoneyCommand"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyApplication" ADD CONSTRAINT "MoneyApplication_reversesApplicationId_fk" FOREIGN KEY ("organizationId","reversesApplicationId") REFERENCES "public"."MoneyApplication"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyCommand" ADD CONSTRAINT "MoneyCommand_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyRefundSettlement" ADD CONSTRAINT "MoneyRefundSettlement_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyRefundSettlement" ADD CONSTRAINT "MoneyRefundSettlement_refundTransactionId_fk" FOREIGN KEY ("organizationId","refundTransactionId") REFERENCES "public"."MoneyTransaction"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyRefundSettlement" ADD CONSTRAINT "MoneyRefundSettlement_originalTransactionId_fk" FOREIGN KEY ("organizationId","originalTransactionId") REFERENCES "public"."MoneyTransaction"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyRefundSettlement" ADD CONSTRAINT "MoneyRefundSettlement_customerCreditMemoInstanceId_fk" FOREIGN KEY ("organizationId","customerCreditMemoInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyRefundSettlement" ADD CONSTRAINT "MoneyRefundSettlement_vendorCreditInstanceId_fk" FOREIGN KEY ("organizationId","vendorCreditInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyRefundSettlement" ADD CONSTRAINT "MoneyRefundSettlement_unappliedMoneyTransactionId_fk" FOREIGN KEY ("organizationId","unappliedMoneyTransactionId") REFERENCES "public"."MoneyTransaction"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyRefundSettlement" ADD CONSTRAINT "MoneyRefundSettlement_commandId_fk" FOREIGN KEY ("organizationId","commandId") REFERENCES "public"."MoneyCommand"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneySourceLink" ADD CONSTRAINT "MoneySourceLink_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneySourceLink" ADD CONSTRAINT "MoneySourceLink_sourceObjectId_fk" FOREIGN KEY ("organizationId","sourceObjectId") REFERENCES "public"."FinancialSourceObject"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneySourceLink" ADD CONSTRAINT "MoneySourceLink_moneyTransactionId_fk" FOREIGN KEY ("organizationId","moneyTransactionId") REFERENCES "public"."MoneyTransaction"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneySourceLink" ADD CONSTRAINT "MoneySourceLink_verifiedByCommandId_fk" FOREIGN KEY ("organizationId","verifiedByCommandId") REFERENCES "public"."MoneyCommand"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_partyInstanceId_fk" FOREIGN KEY ("organizationId","partyInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_cashAccountInstanceId_fk" FOREIGN KEY ("organizationId","cashAccountInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_recordedByCommandId_fk" FOREIGN KEY ("organizationId","recordedByCommandId") REFERENCES "public"."MoneyCommand"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_record_id_fk" FOREIGN KEY ("organizationId","id") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_sourceAccountId_fk" FOREIGN KEY ("organizationId","sourceAccountId") REFERENCES "public"."FinancialSourceAccount"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_sourceObjectId_fk" FOREIGN KEY ("organizationId","sourceObjectId") REFERENCES "public"."FinancialSourceObject"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_currentObservationId_fk" FOREIGN KEY ("organizationId","currentObservationId") REFERENCES "public"."FinancialSourceObservation"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_destinationBankAccountInstanceId_fk" FOREIGN KEY ("organizationId","destinationBankAccountInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD CONSTRAINT "ProcessorBalanceEntry_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD CONSTRAINT "ProcessorBalanceEntry_record_id_fk" FOREIGN KEY ("organizationId","id") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD CONSTRAINT "ProcessorBalanceEntry_sourceAccountId_fk" FOREIGN KEY ("organizationId","sourceAccountId") REFERENCES "public"."FinancialSourceAccount"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD CONSTRAINT "ProcessorBalanceEntry_sourceObjectId_fk" FOREIGN KEY ("organizationId","sourceObjectId") REFERENCES "public"."FinancialSourceObject"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD CONSTRAINT "ProcessorBalanceEntry_currentObservationId_fk" FOREIGN KEY ("organizationId","currentObservationId") REFERENCES "public"."FinancialSourceObservation"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProviderLedgerEntry" ADD CONSTRAINT "ProviderLedgerEntry_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProviderLedgerEntry" ADD CONSTRAINT "ProviderLedgerEntry_bookId_ExternalAccountingBook_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."ExternalAccountingBook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProviderLedgerLine" ADD CONSTRAINT "ProviderLedgerLine_entryId_ProviderLedgerEntry_id_fk" FOREIGN KEY ("entryId") REFERENCES "public"."ProviderLedgerEntry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ExportBatch_grain_key" ON "ExportBatch" USING btree ("organizationId","bookId","avenue","grainKey",coalesce("storeId", ''),coalesce("railId", ''),"currency") WHERE "ExportBatch"."state" <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "ExportBatch_org_state_idx" ON "ExportBatch" USING btree ("organizationId","state");--> statement-breakpoint
CREATE INDEX "ExportBatch_sweep_idx" ON "ExportBatch" USING btree ("state","nextAttemptAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ExportBatchPosting_live_posting_key" ON "ExportBatchPosting" USING btree ("organizationId","glPostingId") WHERE "ExportBatchPosting"."withdrawnAt" IS NULL;--> statement-breakpoint
CREATE INDEX "ExportBatchPosting_batch_idx" ON "ExportBatchPosting" USING btree ("organizationId","batchId");--> statement-breakpoint
CREATE UNIQUE INDEX "ExternalBookConnection_active_key" ON "ExternalBookConnection" USING btree ("organizationId") WHERE "ExternalBookConnection"."state" = 'active';--> statement-breakpoint
CREATE INDEX "FinancialSourceAcceptance_recovery_idx" ON "FinancialSourceAcceptance" USING btree ("organizationId","state","nextAttemptAt");--> statement-breakpoint
CREATE UNIQUE INDEX "GlPostingSource_claim_key" ON "GlPostingSource" USING btree ("organizationId","sourceKind","sourceId","occurrence") WHERE "GlPostingSource"."linkRole" = 'subject';--> statement-breakpoint
CREATE INDEX "GlPostingSource_source_idx" ON "GlPostingSource" USING btree ("organizationId","sourceKind","sourceId");--> statement-breakpoint
CREATE INDEX "GlPostingSource_posting_idx" ON "GlPostingSource" USING btree ("glPostingId");--> statement-breakpoint
CREATE INDEX "MoneyApplication_quote_idx" ON "MoneyApplication" USING btree ("organizationId","quoteInstanceId");--> statement-breakpoint
CREATE INDEX "MoneyTransaction_quote_idx" ON "MoneyTransaction" USING btree ("organizationId","quoteInstanceId");--> statement-breakpoint
CREATE INDEX "MoneyTransaction_work_order_idx" ON "MoneyTransaction" USING btree ("organizationId","workOrderInstanceId");--> statement-breakpoint
CREATE INDEX "MoneyTransaction_bank_deposit_idx" ON "MoneyTransaction" USING btree ("organizationId","bankDepositInstanceId");--> statement-breakpoint
CREATE INDEX "ProcessorBalanceEntry_payout_idx" ON "ProcessorBalanceEntry" USING btree ("organizationId","sourceAccountId","payoutExternalId");--> statement-breakpoint
CREATE UNIQUE INDEX "ProviderLedgerEntry_txn_key" ON "ProviderLedgerEntry" USING btree ("organizationId","bookId","providerTxnType","providerTxnId");--> statement-breakpoint
CREATE INDEX "ProviderLedgerEntry_range_idx" ON "ProviderLedgerEntry" USING btree ("organizationId","bookId","txnDate");--> statement-breakpoint
CREATE INDEX "ProviderLedgerEntry_author_idx" ON "ProviderLedgerEntry" USING btree ("organizationId","bookId","author");--> statement-breakpoint
CREATE INDEX "ProviderLedgerLine_entry_idx" ON "ProviderLedgerLine" USING btree ("entryId");--> statement-breakpoint
ALTER TABLE "GlPosting" ADD CONSTRAINT "GlPosting_storeId_FinancialSourceAccount_id_fk" FOREIGN KEY ("storeId") REFERENCES "public"."FinancialSourceAccount"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD CONSTRAINT "GlRoleAssignment_sourceAccountId_fk" FOREIGN KEY ("organizationId","sourceAccountId") REFERENCES "public"."FinancialSourceAccount"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD CONSTRAINT "GlRoleAssignment_paymentGatewayId_fk" FOREIGN KEY ("organizationId","paymentGatewayId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "GlRoleAssignment_org_role_default_key" ON "GlRoleAssignment" USING btree ("organizationId","role") WHERE "GlRoleAssignment"."sourceAccountId" IS NULL AND "GlRoleAssignment"."paymentGatewayId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "GlRoleAssignment_org_role_source_key" ON "GlRoleAssignment" USING btree ("organizationId","role","sourceAccountId") WHERE "GlRoleAssignment"."sourceAccountId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "GlRoleAssignment_org_role_rail_key" ON "GlRoleAssignment" USING btree ("organizationId","role","paymentGatewayId",coalesce("currency", '')) WHERE "GlRoleAssignment"."paymentGatewayId" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "requestId";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "exportStatus";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "providerId";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "providerEntryId";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "providerTenantId";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "failureReason";--> statement-breakpoint
ALTER TABLE "GlPosting" DROP COLUMN "attempts";--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD CONSTRAINT "GlRoleAssignment_scope_exclusive_check" CHECK (num_nonnulls("GlRoleAssignment"."sourceAccountId", "GlRoleAssignment"."paymentGatewayId") <= 1);--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD CONSTRAINT "GlRoleAssignment_currency_rail_check" CHECK ("GlRoleAssignment"."currency" IS NULL OR "GlRoleAssignment"."paymentGatewayId" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD CONSTRAINT "GlRoleAssignment_currency_format_check" CHECK ("GlRoleAssignment"."currency" IS NULL OR "GlRoleAssignment"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
DROP TYPE "public"."GlPostingExportStatus";