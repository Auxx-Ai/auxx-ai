// packages/services/src/custom-fields/ownership.ts

/**
 * A field is "protected" when its definition (name, type, options, …) and its
 * existence are owned by the platform or an installed app, not the user:
 *
 * - `systemAttribute` — platform/system field (e.g. primary_email).
 * - `appInstallationId` — app-registered field; only uninstall removes it.
 *
 * Protected fields are user-read-only: the API rejects user edits/deletes of
 * them. The two markers are parallel — app fields do **not** set
 * `systemAttribute`.
 */
export const isProtectedField = (f: {
  systemAttribute: string | null
  appInstallationId: string | null
}) => !!f.systemAttribute || !!f.appInstallationId
