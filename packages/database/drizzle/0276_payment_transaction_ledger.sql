CREATE TABLE "PaymentTransaction" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"paymentAccountId" text,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"applicationFeeAmount" integer,
	"invoiceInstanceId" text NOT NULL,
	"paymentInstanceId" text,
	"method" text,
	"reference" text,
	"note" text,
	"stripePaymentIntentId" text,
	"stripeChargeId" text,
	"stripeCheckoutSessionId" text,
	"stripeRefundId" text,
	"refundedTransactionId" text,
	"failureCode" text,
	"failureMessage" text,
	"createdByUserId" text,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_invoiceInstanceId_EntityInstance_id_fk" FOREIGN KEY ("invoiceInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_paymentInstanceId_EntityInstance_id_fk" FOREIGN KEY ("paymentInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_refundedTransactionId_PaymentTransaction_id_fk" FOREIGN KEY ("refundedTransactionId") REFERENCES "public"."PaymentTransaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_createdByUserId_User_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "PaymentTransaction_organizationId_invoiceInstanceId_idx" ON "PaymentTransaction" USING btree ("organizationId","invoiceInstanceId");--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentTransaction_stripePaymentIntentId_key" ON "PaymentTransaction" USING btree ("stripePaymentIntentId");