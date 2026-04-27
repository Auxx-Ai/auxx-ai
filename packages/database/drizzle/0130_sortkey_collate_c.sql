ALTER TABLE "AppMarketplaceImage" ALTER COLUMN "sortOrder" SET DATA TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "AppMarketplaceImage" ALTER COLUMN "savedSortOrder" SET DATA TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "CustomField" ALTER COLUMN "sortOrder" SET DATA TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "CustomField" ALTER COLUMN "sortOrder" SET DEFAULT 'a0';--> statement-breakpoint
ALTER TABLE "EntityGroupMember" ALTER COLUMN "sortKey" SET DATA TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "EntityGroupMember" ALTER COLUMN "sortKey" SET DEFAULT 'a0';--> statement-breakpoint
ALTER TABLE "Favorite" ALTER COLUMN "sortOrder" SET DATA TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "FieldValue" ALTER COLUMN "sortKey" SET DATA TYPE text COLLATE "C";--> statement-breakpoint
ALTER TABLE "FieldValue" ALTER COLUMN "sortKey" SET DEFAULT 'a';--> statement-breakpoint
ALTER TABLE "InsightTemplate" ALTER COLUMN "sortOrder" SET DATA TYPE text COLLATE "C";