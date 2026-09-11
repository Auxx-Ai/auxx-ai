-- One live AppInstallation per (app, organization).
--
-- The old unique was over (appId, organizationId, installationType), which let a
-- `development` and a `production` installation of the same app be live at once.
-- Those are not two views of one app: AppSetting, Credential, DataConnector,
-- CustomField and RecordIdentity are all keyed by appInstallationId, so the second
-- row is a second, near-empty copy of the app's state. `pnpm sync-dev` created one
-- beside an installed production app; the settings page wrote allowWrites to the
-- production row and the workflow engine executed the block as the development one,
-- which then refused the write that had just been granted.
--
-- Collapse first, then constrain. Without the collapse this migration fails on any
-- database that already holds a pair (the invariant it introduces is not yet true).

-- Retire every live duplicate, keeping one row per (app, org): production first,
-- then most recently installed, then by id so the choice is total and stable.
-- Production is preferred because it is the row that owns the real state — the
-- credential, the connector, the app's custom fields and its synced records — while
-- a sync-dev row typically owns nothing but its own settings.
--
-- A soft delete, exactly what `uninstallApp` does: `uninstalledAt` is set and the
-- row's AppSetting and Credential rows are deliberately preserved, so this is
-- reversible and discards nothing.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY "appId", "organizationId"
      ORDER BY ("installationType" = 'production') DESC, "installedAt" DESC, id
    ) AS rn
  FROM "AppInstallation"
  WHERE "uninstalledAt" IS NULL
)
UPDATE "AppInstallation"
SET "uninstalledAt" = now(), "updatedAt" = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);--> statement-breakpoint

DROP INDEX "AppInstallation_unique_idx";--> statement-breakpoint

-- Partial, on `uninstalledAt IS NULL`: soft-deleted rows are history and several may
-- accumulate for one app, so only live rows are constrained. This is also what lets
-- `installationType` become mutable — switching an installation between a dev and a
-- published deployment is now a repoint, and would otherwise collide with a
-- soft-deleted row of the type being switched to.
CREATE UNIQUE INDEX "AppInstallation_live_unique_idx" ON "AppInstallation" USING btree ("appId","organizationId") WHERE "uninstalledAt" IS NULL;
