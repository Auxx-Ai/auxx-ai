CREATE INDEX "FieldValue_lookup_text_idx" ON "FieldValue" USING btree ("organizationId","fieldId","valueText") WHERE "valueText" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "FieldValue_lookup_number_idx" ON "FieldValue" USING btree ("organizationId","fieldId","valueNumber") WHERE "valueNumber" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "FieldValue_lookup_option_idx" ON "FieldValue" USING btree ("organizationId","fieldId","optionId") WHERE "optionId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "FieldValue_lookup_related_idx" ON "FieldValue" USING btree ("organizationId","fieldId","relatedEntityId") WHERE "relatedEntityId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "FieldValue_lookup_actor_idx" ON "FieldValue" USING btree ("organizationId","fieldId","actorId") WHERE "actorId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "FieldValue_lookup_date_idx" ON "FieldValue" USING btree ("organizationId","fieldId","valueDate") WHERE "valueDate" IS NOT NULL;