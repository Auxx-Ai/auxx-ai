CREATE TABLE "PaymentAllocation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"paymentTransactionId" text NOT NULL,
	"invoiceInstanceId" text NOT NULL,
	"amount" integer NOT NULL,
	"appliedAt" timestamp (3) DEFAULT now() NOT NULL,
	"createdByUserId" text,
	"paymentInstanceId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PaymentTransaction" DROP CONSTRAINT "PaymentTransaction_paymentInstanceId_EntityInstance_id_fk";
--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD COLUMN "contactInstanceId" text;--> statement-breakpoint
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentTransactionId_PaymentTransaction_id_fk" FOREIGN KEY ("paymentTransactionId") REFERENCES "public"."PaymentTransaction"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceInstanceId_EntityInstance_id_fk" FOREIGN KEY ("invoiceInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_createdByUserId_User_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentInstanceId_EntityInstance_id_fk" FOREIGN KEY ("paymentInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentAllocation_paymentTransactionId_invoiceInstanceId_key" ON "PaymentAllocation" USING btree ("paymentTransactionId","invoiceInstanceId");--> statement-breakpoint
CREATE INDEX "PaymentAllocation_organizationId_invoiceInstanceId_idx" ON "PaymentAllocation" USING btree ("organizationId","invoiceInstanceId");--> statement-breakpoint
CREATE INDEX "PaymentAllocation_paymentTransactionId_idx" ON "PaymentAllocation" USING btree ("paymentTransactionId");--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_contactInstanceId_EntityInstance_id_fk" FOREIGN KEY ("contactInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "PaymentTransaction_organizationId_contactInstanceId_idx" ON "PaymentTransaction" USING btree ("organizationId","contactInstanceId");--> statement-breakpoint
ALTER TABLE "PaymentTransaction" DROP COLUMN "paymentInstanceId";