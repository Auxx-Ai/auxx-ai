CREATE INDEX "MoneyApplication_movement_idx" ON "MoneyApplication" USING btree ("organizationId","moneyTransactionId");--> statement-breakpoint
CREATE INDEX "MoneyApplication_order_idx" ON "MoneyApplication" USING btree ("organizationId","orderInstanceId");--> statement-breakpoint
CREATE INDEX "MoneyApplication_invoice_idx" ON "MoneyApplication" USING btree ("organizationId","invoiceInstanceId");--> statement-breakpoint
CREATE INDEX "MoneyApplication_vendor_bill_idx" ON "MoneyApplication" USING btree ("organizationId","vendorBillInstanceId");--> statement-breakpoint
CREATE INDEX "MoneyApplication_reverses_idx" ON "MoneyApplication" USING btree ("organizationId","reversesApplicationId");--> statement-breakpoint
CREATE INDEX "MoneyTransaction_party_idx" ON "MoneyTransaction" USING btree ("organizationId","partyInstanceId");--> statement-breakpoint
CREATE INDEX "MoneyTransaction_cash_account_idx" ON "MoneyTransaction" USING btree ("organizationId","cashAccountInstanceId");--> statement-breakpoint
CREATE INDEX "Message_htmlBodyStorageLocationId_idx" ON "Message" USING btree ("htmlBodyStorageLocationId");--> statement-breakpoint
CREATE INDEX "Thread_latestMessageId_idx" ON "Thread" USING btree ("latestMessageId");