ALTER TABLE "PaymentRoute" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "PaymentRoute" CASCADE;--> statement-breakpoint
ALTER TABLE "MoneyTransaction" DROP CONSTRAINT IF EXISTS "MoneyTransaction_paymentRouteId_fk";
--> statement-breakpoint
ALTER TABLE "MoneyTransfer" DROP CONSTRAINT IF EXISTS "MoneyTransfer_sourcePaymentRouteId_fk";
--> statement-breakpoint
ALTER TABLE "MoneyTransfer" DROP CONSTRAINT IF EXISTS "MoneyTransfer_destinationPaymentRouteId_fk";
--> statement-breakpoint
ALTER TABLE "MoneyTransaction" DROP COLUMN "paymentRouteId";--> statement-breakpoint
ALTER TABLE "MoneyTransfer" DROP COLUMN "sourcePaymentRouteId";--> statement-breakpoint
ALTER TABLE "MoneyTransfer" DROP COLUMN "destinationPaymentRouteId";