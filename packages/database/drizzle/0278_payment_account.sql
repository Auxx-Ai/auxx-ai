CREATE TABLE "PaymentAccount" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"provider" text NOT NULL,
	"accountType" text DEFAULT 'standard' NOT NULL,
	"stripeAccountId" text,
	"credentialId" text,
	"chargesEnabled" boolean DEFAULT false NOT NULL,
	"detailsSubmitted" boolean DEFAULT false NOT NULL,
	"defaultCurrency" text,
	"applicationFeePercent" numeric,
	"disconnectedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_credentialId_Credential_id_fk" FOREIGN KEY ("credentialId") REFERENCES "public"."Credential"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentAccount_organizationId_provider_key" ON "PaymentAccount" USING btree ("organizationId","provider");--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_paymentAccountId_PaymentAccount_id_fk" FOREIGN KEY ("paymentAccountId") REFERENCES "public"."PaymentAccount"("id") ON DELETE set null ON UPDATE no action;