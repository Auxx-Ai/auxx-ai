CREATE INDEX "DataConnectorItem_mintedInstanceId_idx" ON "DataConnectorItem" USING btree ("mintedInstanceId");--> statement-breakpoint
CREATE INDEX "DuplicateSuggestion_low_idx" ON "DuplicateSuggestion" USING btree ("instanceIdLow");--> statement-breakpoint
CREATE INDEX "DuplicateSuggestion_high_idx" ON "DuplicateSuggestion" USING btree ("instanceIdHigh");--> statement-breakpoint
CREATE INDEX "Message_signatureId_idx" ON "Message" USING btree ("signatureId");--> statement-breakpoint
CREATE INDEX "Thread_primaryEntityInstanceId_idx" ON "Thread" USING btree ("primaryEntityInstanceId");