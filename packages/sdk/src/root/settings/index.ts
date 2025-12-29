export * from './settings-schema.js'

import { string, number, boolean, select, struct } from './settings-schema.js'

/**
 * Settings namespace for cleaner API
 * Use Settings.string(), Settings.select(), etc. in your app settings
 */
export const Settings = {
  string,
  number,
  boolean,
  select,
  struct,
} as const
