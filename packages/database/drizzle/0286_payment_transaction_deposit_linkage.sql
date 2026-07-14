ALTER TABLE "PaymentTransaction" ALTER COLUMN "invoiceInstanceId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD COLUMN "quoteInstanceId" text;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD COLUMN "workOrderInstanceId" text;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_quoteInstanceId_EntityInstance_id_fk" FOREIGN KEY ("quoteInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_workOrderInstanceId_EntityInstance_id_fk" FOREIGN KEY ("workOrderInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "PaymentTransaction_organizationId_workOrderInstanceId_idx" ON "PaymentTransaction" USING btree ("organizationId","workOrderInstanceId");