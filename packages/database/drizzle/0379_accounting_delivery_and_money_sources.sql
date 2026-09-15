CREATE TABLE "AccountingDelivery" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"bookId" text NOT NULL,
	"connectionId" text NOT NULL,
	"glPostingId" text NOT NULL,
	"representation" text NOT NULL,
	"state" text NOT NULL,
	"completedAt" timestamp with time zone,
	"releasedAt" timestamp with time zone,
	CONSTRAINT "AccountingDelivery_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "AccountingDelivery_posting_key" UNIQUE("organizationId","bookId","glPostingId"),
	CONSTRAINT "AccountingDelivery_shape_check" CHECK ("AccountingDelivery"."representation" = 'journal' AND "AccountingDelivery"."state" IN ('pending','blocked','delivered'))
);
--> statement-breakpoint
CREATE TABLE "AccountingDeliveryCoverage" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"bookId" text NOT NULL,
	"deliveryId" text NOT NULL,
	"effectId" text NOT NULL,
	"componentKey" text DEFAULT 'whole_effect' NOT NULL,
	CONSTRAINT "AccountingDeliveryCoverage_book_effect_key" UNIQUE("organizationId","bookId","effectId"),
	CONSTRAINT "AccountingDeliveryCoverage_component_check" CHECK ("AccountingDeliveryCoverage"."componentKey" = 'whole_effect')
);
--> statement-breakpoint
CREATE TABLE "AccountingDeliveryOperation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deliveryId" text NOT NULL,
	"operationKey" text NOT NULL,
	"objectType" text NOT NULL,
	"requestId" text NOT NULL,
	"state" text NOT NULL,
	"payload" jsonb,
	"payloadHash" text,
	"mappingBasis" jsonb,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"firstSentAt" timestamp with time zone,
	"leaseToken" text,
	"leaseExpiresAt" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone,
	"failureReason" text,
	"outcome" jsonb,
	CONSTRAINT "AccountingDeliveryOperation_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "AccountingDeliveryOperation_key" UNIQUE("organizationId","deliveryId","operationKey"),
	CONSTRAINT "AccountingDeliveryOperation_request_key" UNIQUE("organizationId","requestId"),
	CONSTRAINT "AccountingDeliveryOperation_state_check" CHECK ("AccountingDeliveryOperation"."state" IN ('pending','prepared','sending','uncertain','blocked','succeeded') AND "AccountingDeliveryOperation"."objectType" IN ('JournalEntry','Customer') AND "AccountingDeliveryOperation"."attempts" >= 0),
	CONSTRAINT "AccountingDeliveryOperation_payload_check" CHECK ((("AccountingDeliveryOperation"."payload" IS NULL AND "AccountingDeliveryOperation"."payloadHash" IS NULL AND "AccountingDeliveryOperation"."firstSentAt" IS NULL) OR ("AccountingDeliveryOperation"."payload" IS NOT NULL AND "AccountingDeliveryOperation"."payloadHash" ~ '^[0-9a-f]{64}$')) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE "ExternalAccountingObject" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"bookId" text NOT NULL,
	"operationId" text NOT NULL,
	"objectType" text NOT NULL,
	"externalId" text NOT NULL,
	"author" text NOT NULL,
	"remoteVersion" text,
	"remoteBasis" jsonb NOT NULL,
	"componentCoverage" jsonb NOT NULL,
	CONSTRAINT "ExternalAccountingObject_remote_key" UNIQUE("organizationId","bookId","objectType","externalId"),
	CONSTRAINT "ExternalAccountingObject_operation_key" UNIQUE("organizationId","operationId"),
	CONSTRAINT "ExternalAccountingObject_shape_check" CHECK ("ExternalAccountingObject"."author" = 'auxx' AND "ExternalAccountingObject"."objectType" IN ('JournalEntry','Customer'))
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
	"paymentRouteId" text,
	"cashAccountInstanceId" text,
	"recordedByCommandId" text NOT NULL,
	"reference" text,
	"note" text,
	CONSTRAINT "MoneyTransaction_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "MoneyTransaction_money_check" CHECK ("MoneyTransaction"."amountMinor" > 0 AND "MoneyTransaction"."currency" ~ '^[A-Z]{3}$' AND "MoneyTransaction"."currencyExponent" BETWEEN 0 AND 4 AND "MoneyTransaction"."purpose" IN ('customer_receipt','customer_refund','vendor_payment','vendor_refund')),
	CONSTRAINT "MoneyTransaction_date_check" CHECK (("MoneyTransaction"."datePrecision" = 'instant' AND "MoneyTransaction"."occurredAt" IS NOT NULL AND "MoneyTransaction"."occurredOn" IS NULL) OR ("MoneyTransaction"."datePrecision" = 'date' AND "MoneyTransaction"."occurredAt" IS NULL AND "MoneyTransaction"."occurredOn" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "PaymentRoute" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"method" text NOT NULL,
	"settlementCurrency" text NOT NULL,
	"processorAccountId" text,
	"paymentGatewayInstanceId" text,
	"bankAccountInstanceId" text,
	"cashGlAccountInstanceId" text,
	"archivedAt" timestamp with time zone,
	CONSTRAINT "PaymentRoute_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "PaymentRoute_shape_check" CHECK (("PaymentRoute"."kind" = 'processor' AND "PaymentRoute"."processorAccountId" IS NOT NULL AND "PaymentRoute"."paymentGatewayInstanceId" IS NOT NULL AND "PaymentRoute"."bankAccountInstanceId" IS NULL AND "PaymentRoute"."cashGlAccountInstanceId" IS NULL) OR ("PaymentRoute"."kind" = 'manual' AND "PaymentRoute"."processorAccountId" IS NULL AND "PaymentRoute"."paymentGatewayInstanceId" IS NULL AND num_nonnulls("PaymentRoute"."bankAccountInstanceId", "PaymentRoute"."cashGlAccountInstanceId") = 1))
);
--> statement-breakpoint
ALTER TABLE "AccountingDelivery" ADD CONSTRAINT "AccountingDelivery_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingDelivery" ADD CONSTRAINT "AccountingDelivery_book_scope_fk" FOREIGN KEY ("organizationId","bookId") REFERENCES "public"."ExternalAccountingBook"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingDelivery" ADD CONSTRAINT "AccountingDelivery_connection_scope_fk" FOREIGN KEY ("organizationId","connectionId") REFERENCES "public"."ExternalBookConnection"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingDelivery" ADD CONSTRAINT "AccountingDelivery_posting_scope_fk" FOREIGN KEY ("organizationId","glPostingId") REFERENCES "public"."GlPosting"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingDeliveryCoverage" ADD CONSTRAINT "AccountingDeliveryCoverage_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingDeliveryCoverage" ADD CONSTRAINT "AccountingDeliveryCoverage_book_scope_fk" FOREIGN KEY ("organizationId","bookId") REFERENCES "public"."ExternalAccountingBook"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingDeliveryCoverage" ADD CONSTRAINT "AccountingDeliveryCoverage_delivery_scope_fk" FOREIGN KEY ("organizationId","deliveryId") REFERENCES "public"."AccountingDelivery"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingDeliveryCoverage" ADD CONSTRAINT "AccountingDeliveryCoverage_effect_scope_fk" FOREIGN KEY ("organizationId","effectId") REFERENCES "public"."AccountingEffect"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingDeliveryOperation" ADD CONSTRAINT "AccountingDeliveryOperation_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingDeliveryOperation" ADD CONSTRAINT "AccountingDeliveryOperation_delivery_scope_fk" FOREIGN KEY ("organizationId","deliveryId") REFERENCES "public"."AccountingDelivery"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExternalAccountingObject" ADD CONSTRAINT "ExternalAccountingObject_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExternalAccountingObject" ADD CONSTRAINT "ExternalAccountingObject_book_scope_fk" FOREIGN KEY ("organizationId","bookId") REFERENCES "public"."ExternalAccountingBook"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExternalAccountingObject" ADD CONSTRAINT "ExternalAccountingObject_operation_scope_fk" FOREIGN KEY ("organizationId","operationId") REFERENCES "public"."AccountingDeliveryOperation"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" ADD CONSTRAINT "FinancialSourceAcceptance_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" ADD CONSTRAINT "FinancialSourceAcceptance_sourceObjectId_fk" FOREIGN KEY ("organizationId","sourceObjectId") REFERENCES "public"."FinancialSourceObject"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" ADD CONSTRAINT "FinancialSourceAcceptance_observationId_fk" FOREIGN KEY ("organizationId","observationId") REFERENCES "public"."FinancialSourceObservation"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" ADD CONSTRAINT "FinancialSourceAcceptance_orderInstanceId_fk" FOREIGN KEY ("organizationId","orderInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAcceptance" ADD CONSTRAINT "FinancialSourceAcceptance_moneyTransactionId_fk" FOREIGN KEY ("organizationId","moneyTransactionId") REFERENCES "public"."MoneyTransaction"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceAccount" ADD CONSTRAINT "FinancialSourceAccount_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceCoverage" ADD CONSTRAINT "FinancialSourceCoverage_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceCoverage" ADD CONSTRAINT "FinancialSourceCoverage_sourceAccountId_fk" FOREIGN KEY ("organizationId","sourceAccountId") REFERENCES "public"."FinancialSourceAccount"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceObject" ADD CONSTRAINT "FinancialSourceObject_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceObject" ADD CONSTRAINT "FinancialSourceObject_sourceAccountId_fk" FOREIGN KEY ("organizationId","sourceAccountId") REFERENCES "public"."FinancialSourceAccount"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceObservation" ADD CONSTRAINT "FinancialSourceObservation_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FinancialSourceObservation" ADD CONSTRAINT "FinancialSourceObservation_sourceObjectId_fk" FOREIGN KEY ("organizationId","sourceObjectId") REFERENCES "public"."FinancialSourceObject"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_paymentRouteId_fk" FOREIGN KEY ("organizationId","paymentRouteId") REFERENCES "public"."PaymentRoute"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_cashAccountInstanceId_fk" FOREIGN KEY ("organizationId","cashAccountInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_recordedByCommandId_fk" FOREIGN KEY ("organizationId","recordedByCommandId") REFERENCES "public"."MoneyCommand"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PaymentRoute" ADD CONSTRAINT "PaymentRoute_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PaymentRoute" ADD CONSTRAINT "PaymentRoute_processorAccountId_fk" FOREIGN KEY ("organizationId","processorAccountId") REFERENCES "public"."FinancialSourceAccount"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PaymentRoute" ADD CONSTRAINT "PaymentRoute_paymentGatewayInstanceId_fk" FOREIGN KEY ("organizationId","paymentGatewayInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PaymentRoute" ADD CONSTRAINT "PaymentRoute_bankAccountInstanceId_fk" FOREIGN KEY ("organizationId","bankAccountInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PaymentRoute" ADD CONSTRAINT "PaymentRoute_cashGlAccountInstanceId_fk" FOREIGN KEY ("organizationId","cashGlAccountInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AccountingDeliveryOperation_recovery_idx" ON "AccountingDeliveryOperation" USING btree ("state","nextAttemptAt");--> statement-breakpoint
CREATE INDEX "FinancialSourceAcceptance_recovery_idx" ON "FinancialSourceAcceptance" USING btree ("organizationId","state","nextAttemptAt");--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentRoute_processor_key" ON "PaymentRoute" USING btree ("organizationId","processorAccountId","method","settlementCurrency") WHERE "PaymentRoute"."kind" = 'processor';--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentRoute_bank_key" ON "PaymentRoute" USING btree ("organizationId","bankAccountInstanceId","method","settlementCurrency") WHERE "PaymentRoute"."kind" = 'manual' AND "PaymentRoute"."bankAccountInstanceId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentRoute_cash_key" ON "PaymentRoute" USING btree ("organizationId","cashGlAccountInstanceId","method","settlementCurrency") WHERE "PaymentRoute"."kind" = 'manual' AND "PaymentRoute"."cashGlAccountInstanceId" IS NOT NULL;