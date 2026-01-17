// apps/web/src/components/dynamic-table/config/table-config.ts

/**
 * Dynamic table configuration flags.
 * These can be toggled to change behavior without code changes.
 */
export const DYNAMIC_TABLE_CONFIG = {
  /**
   * When true, view changes are auto-saved after a debounce period.
   * When false, users must manually click the save button.
   *
   * Set to false to require manual save.
   * Set to true to enable auto-save.
   */
  AUTO_SAVE_ENABLED: false,

  /**
   * Debounce delay in ms for auto-save (when enabled).
   */
  AUTO_SAVE_DEBOUNCE_MS: 300,
} as const
