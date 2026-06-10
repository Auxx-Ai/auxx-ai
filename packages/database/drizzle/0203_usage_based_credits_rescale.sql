-- Usage-based credits cutover (data-only): rescale existing credit counters ×100.
-- 1 old multiplier-credit ≈ 100 new USD-metered credits (1 credit = $0.0001 COGS).
-- quotaLimit = -1 is the unlimited sentinel and must NOT be scaled.
UPDATE "OrganizationAiQuota" SET "quotaLimit" = "quotaLimit" * 100 WHERE "quotaLimit" <> -1;--> statement-breakpoint
UPDATE "OrganizationAiQuota" SET "quotaUsed" = "quotaUsed" * 100;--> statement-breakpoint
UPDATE "PlanSubscription" SET "creditsBalance" = "creditsBalance" * 100;
