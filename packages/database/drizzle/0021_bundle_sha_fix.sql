ALTER TABLE "AppVersionBundle" RENAME COLUMN "clientBundleSha" TO "bundleSha";--> statement-breakpoint
ALTER TABLE "AppVersionBundle" DROP COLUMN "serverBundleSha";