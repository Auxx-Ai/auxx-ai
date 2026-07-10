// packages/lib/src/settings/client.ts
// CLIENT-SAFE: the settings catalog + its types, no server deps (no DB, no cache).
// Client code must not import `@auxx/lib/settings` (the server barrel pulls in
// drizzle/DB code) — import this subpath instead for `SettingKey`/`isSettingKey`.

export { isSettingKey, SETTINGS_CATALOG, type SettingConfig, type SettingKey } from './catalog'
export type { SettingScope, SettingValue } from './types'
