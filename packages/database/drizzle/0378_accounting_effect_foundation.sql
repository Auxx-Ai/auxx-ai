CREATE TABLE "AccountingEffect" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"workId" text NOT NULL,
	"basisVersion" integer NOT NULL,
	"glPostingId" text NOT NULL,
	"effectiveDate" date NOT NULL,
	"currency" text NOT NULL,
	"currencyExponent" integer NOT NULL,
	"acceptedBasis" jsonb NOT NULL,
	"basisHash" text NOT NULL,
	CONSTRAINT "AccountingEffect_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "AccountingEffect_org_work_key" UNIQUE("organizationId","workId"),
	CONSTRAINT "AccountingEffect_version_check" CHECK ("AccountingEffect"."basisVersion" > 0 AND "AccountingEffect"."currencyExponent" BETWEEN 0 AND 9),
	CONSTRAINT "AccountingEffect_currency_check" CHECK ("AccountingEffect"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "AccountingEffect_hash_check" CHECK ("AccountingEffect"."basisHash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "AccountingWorkBasis" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"workId" text NOT NULL,
	"version" integer NOT NULL,
	"sourceHash" text NOT NULL,
	"effectiveDate" date,
	"basis" jsonb NOT NULL,
	CONSTRAINT "AccountingWorkBasis_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "AccountingWorkBasis_org_work_version_key" UNIQUE("organizationId","workId","version"),
	CONSTRAINT "AccountingWorkBasis_version_check" CHECK ("AccountingWorkBasis"."version" > 0),
	CONSTRAINT "AccountingWorkBasis_hash_check" CHECK ("AccountingWorkBasis"."sourceHash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "AccountingWorkBasis_ready_date_check" CHECK ((("AccountingWorkBasis"."basis"->>'status' = 'incomplete') OR ("AccountingWorkBasis"."basis"->>'status' = 'ready' AND "AccountingWorkBasis"."effectiveDate" IS NOT NULL)) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE "AccountingWork" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"entityInstanceId" text NOT NULL,
	"effectKind" text NOT NULL,
	"componentKey" text DEFAULT 'original' NOT NULL,
	"effectKey" text NOT NULL,
	"operation" text NOT NULL,
	"correctsEffectId" text,
	"basisVersion" integer NOT NULL,
	"state" text NOT NULL,
	"eligibility" text NOT NULL,
	"blockedReason" text,
	"nextAttemptAt" timestamp with time zone,
	"leaseUntil" timestamp with time zone,
	"leaseToken" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "AccountingWork_org_id_key" UNIQUE("organizationId","id"),
	CONSTRAINT "AccountingWork_org_effect_key" UNIQUE("organizationId","effectKey"),
	CONSTRAINT "AccountingWork_kind_check" CHECK ("AccountingWork"."effectKind" = 'fulfillment_accounting'),
	CONSTRAINT "AccountingWork_correction_check" CHECK (("AccountingWork"."operation" = 'original' AND "AccountingWork"."correctsEffectId" IS NULL AND "AccountingWork"."componentKey" = 'original') OR ("AccountingWork"."operation" = 'correction' AND "AccountingWork"."correctsEffectId" IS NOT NULL)),
	CONSTRAINT "AccountingWork_state_check" CHECK ("AccountingWork"."state" IN ('pending', 'blocked', 'accepted', 'no_effect', 'canceled')),
	CONSTRAINT "AccountingWork_eligibility_check" CHECK ("AccountingWork"."eligibility" IN ('automatic', 'manual', 'excluded')),
	CONSTRAINT "AccountingWork_version_check" CHECK ("AccountingWork"."basisVersion" > 0 AND "AccountingWork"."attempts" >= 0),
	CONSTRAINT "AccountingWork_lease_check" CHECK (("AccountingWork"."leaseUntil" IS NULL) = ("AccountingWork"."leaseToken" IS NULL))
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
ALTER TABLE "GlPosting" ADD COLUMN "deliveryIntent" text;--> statement-breakpoint
ALTER TABLE "GlPosting" ADD COLUMN "intendedBookConnectionId" text;--> statement-breakpoint
ALTER TABLE "AccountingEffect" ADD CONSTRAINT "AccountingEffect_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingEffect" ADD CONSTRAINT "AccountingEffect_basis_scope_fk" FOREIGN KEY ("organizationId","workId","basisVersion") REFERENCES "public"."AccountingWorkBasis"("organizationId","workId","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingEffect" ADD CONSTRAINT "AccountingEffect_posting_scope_fk" FOREIGN KEY ("organizationId","glPostingId") REFERENCES "public"."GlPosting"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingWorkBasis" ADD CONSTRAINT "AccountingWorkBasis_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingWorkBasis" ADD CONSTRAINT "AccountingWorkBasis_work_scope_fk" FOREIGN KEY ("organizationId","workId") REFERENCES "public"."AccountingWork"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingWork" ADD CONSTRAINT "AccountingWork_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingWork" ADD CONSTRAINT "AccountingWork_entity_scope_fk" FOREIGN KEY ("organizationId","entityInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountingWork" ADD CONSTRAINT "AccountingWork_correction_scope_fk" FOREIGN KEY ("organizationId","correctsEffectId") REFERENCES "public"."AccountingEffect"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExternalAccountingBook" ADD CONSTRAINT "ExternalAccountingBook_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExternalBookConnection" ADD CONSTRAINT "ExternalBookConnection_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExternalBookConnection" ADD CONSTRAINT "ExternalBookConnection_book_scope_fk" FOREIGN KEY ("organizationId","bookId") REFERENCES "public"."ExternalAccountingBook"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExternalBookConnection" ADD CONSTRAINT "ExternalBookConnection_credential_scope_fk" FOREIGN KEY ("credentialOrganizationId","credentialId") REFERENCES "public"."Credential"("organizationId","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AccountingEffect_posting_idx" ON "AccountingEffect" USING btree ("organizationId","glPostingId");--> statement-breakpoint
CREATE UNIQUE INDEX "AccountingWork_fulfillment_original_key" ON "AccountingWork" USING btree ("organizationId","entityInstanceId","effectKind") WHERE "AccountingWork"."operation" = 'original';--> statement-breakpoint
CREATE INDEX "AccountingWork_retry_idx" ON "AccountingWork" USING btree ("organizationId","state","eligibility","nextAttemptAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ExternalBookConnection_active_key" ON "ExternalBookConnection" USING btree ("organizationId") WHERE "ExternalBookConnection"."state" = 'active';--> statement-breakpoint
ALTER TABLE "GlPosting" ADD CONSTRAINT "GlPosting_intended_connection_scope_fk" FOREIGN KEY ("organizationId","intendedBookConnectionId") REFERENCES "public"."ExternalBookConnection"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GlPosting" ADD CONSTRAINT "GlPosting_delivery_intent_check" CHECK ((("GlPosting"."deliveryIntent" IS NULL AND "GlPosting"."intendedBookConnectionId" IS NULL) OR ("GlPosting"."deliveryIntent" = 'not_required' AND "GlPosting"."intendedBookConnectionId" IS NULL) OR ("GlPosting"."deliveryIntent" IN ('manual', 'automatic') AND "GlPosting"."intendedBookConnectionId" IS NOT NULL)) IS TRUE);