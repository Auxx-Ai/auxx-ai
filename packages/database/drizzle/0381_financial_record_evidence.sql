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
	"sourcePaymentRouteId" text,
	"destinationPaymentRouteId" text,
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
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_record_id_fk" FOREIGN KEY ("organizationId","id") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_sourceAccountId_fk" FOREIGN KEY ("organizationId","sourceAccountId") REFERENCES "public"."FinancialSourceAccount"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_sourceObjectId_fk" FOREIGN KEY ("organizationId","sourceObjectId") REFERENCES "public"."FinancialSourceObject"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_currentObservationId_fk" FOREIGN KEY ("organizationId","currentObservationId") REFERENCES "public"."FinancialSourceObservation"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_sourcePaymentRouteId_fk" FOREIGN KEY ("organizationId","sourcePaymentRouteId") REFERENCES "public"."PaymentRoute"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_destinationPaymentRouteId_fk" FOREIGN KEY ("organizationId","destinationPaymentRouteId") REFERENCES "public"."PaymentRoute"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MoneyTransfer" ADD CONSTRAINT "MoneyTransfer_destinationBankAccountInstanceId_fk" FOREIGN KEY ("organizationId","destinationBankAccountInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD CONSTRAINT "ProcessorBalanceEntry_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD CONSTRAINT "ProcessorBalanceEntry_record_id_fk" FOREIGN KEY ("organizationId","id") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD CONSTRAINT "ProcessorBalanceEntry_sourceAccountId_fk" FOREIGN KEY ("organizationId","sourceAccountId") REFERENCES "public"."FinancialSourceAccount"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD CONSTRAINT "ProcessorBalanceEntry_sourceObjectId_fk" FOREIGN KEY ("organizationId","sourceObjectId") REFERENCES "public"."FinancialSourceObject"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ProcessorBalanceEntry" ADD CONSTRAINT "ProcessorBalanceEntry_currentObservationId_fk" FOREIGN KEY ("organizationId","currentObservationId") REFERENCES "public"."FinancialSourceObservation"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ProcessorBalanceEntry_payout_idx" ON "ProcessorBalanceEntry" USING btree ("organizationId","sourceAccountId","payoutExternalId");