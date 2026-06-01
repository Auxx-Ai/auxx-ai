// packages/lib/src/audit-log/client.ts
// Client-safe entry (@auxx/lib/audit-log/client). Pure types + enums only — no server
// deps — so client components (e.g. the Account Activity filters) can import these.

export { AUDIT_ACTIONS, type AuditAction } from './audit-actions'
export {
  AUDIT_ACTOR_TYPES,
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  AUDIT_VISIBILITIES,
  type AuditActorType,
  type AuditCategory,
  type AuditVisibility,
} from './constants'
