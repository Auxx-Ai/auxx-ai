// packages/lib/src/audit-log/index.ts
// Server entry for the audit-log module (@auxx/lib/audit-log). Functional helpers for
// writing, listing, and exporting immutable audit rows. For client-safe types/enums,
// import from @auxx/lib/audit-log/client instead.

export {
  AUDIT_ACTOR_TYPES,
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  AUDIT_VISIBILITIES,
  type AuditActorType,
  type AuditCategory,
  type AuditVisibility,
} from './constants'
export type { AuditLogError } from './errors'
export {
  type AuditExportFormat,
  type AuditExportInput,
  type AuditExportResult,
  exportAuditEvents,
} from './export-audit-events'
export { listAllAuditEvents } from './list-all-audit-events'
export { listAuditEvents } from './list-audit-events'
export { recordAudit } from './record-audit'
export type {
  AuditContext,
  AuditCursor,
  AuditInput,
  AuditLogEntity,
  ListAllAuditEventsInput,
  ListAuditEventsInput,
  ListAuditEventsResult,
} from './types'
