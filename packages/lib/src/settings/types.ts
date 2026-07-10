// packages/lib/src/settings/types.ts

/** Raw value shape stored in `OrganizationSetting`/`UserSetting.value` jsonb columns. */
export type SettingValue = string | number | boolean | object | null

/**
 * DB storage scope for a setting — matches the `SettingScope` Postgres enum
 * (`packages/database/src/db/schema/_shared.ts`). Also used for grouping/filtering
 * in the catalog and UI.
 */
export type SettingScope =
  | 'APPEARANCE'
  | 'NOTIFICATION'
  | 'DASHBOARD'
  | 'COMMUNICATION'
  | 'SECURITY'
  | 'INTEGRATION'
  | 'GENERAL'
  | 'SIDEBAR'
  | 'RECORDING'
  | 'KOPILOT'
  | 'ONBOARDING'
  | 'INVENTORY_BRIDGE'
