ALTER TABLE "VendorPart" RENAME COLUMN "vendorId" TO "contactId";--> statement-breakpoint
DROP INDEX "VendorPart_partId_vendorId_key";--> statement-breakpoint
ALTER TABLE "Vendor" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "Vendor" CASCADE;--> statement-breakpoint
ALTER TABLE "Contact" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "VendorPart" ADD CONSTRAINT "VendorPart_contactId_Contact_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "VendorPart_partId_contactId_key" ON "VendorPart" USING btree ("partId","contactId");
