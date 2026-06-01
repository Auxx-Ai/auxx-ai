// packages/lib/src/audit-log/constants.ts
// Pure, client-safe single source of truth for audit-log unions. No server imports —
// safe to pull into client components (filters) via @auxx/lib/audit-log/client.

/** Coarse grouping for an audit event. Plain strings in the DB; narrowed here for code. */
export const AUDIT_CATEGORIES = [
  'auth',
  'members',
  'settings',
  'billing',
  'integrations',
  'apps',
  'data_export',
  'security',
] as const
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]

/** Which lens a row belongs to: customer-visible feed vs. super-admin only. */
export const AUDIT_VISIBILITIES = ['admin', 'internal'] as const
export type AuditVisibility = (typeof AUDIT_VISIBILITIES)[number]

/** Who performed the action. */
export const AUDIT_ACTOR_TYPES = ['user', 'system', 'api', 'integration', 'admin'] as const
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number]

/** Human labels for the category filter UI. */
export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  auth: 'Authentication',
  members: 'Members',
  settings: 'Settings',
  billing: 'Billing',
  integrations: 'Integrations',
  apps: 'Apps',
  data_export: 'Data export',
  security: 'Security',
}
