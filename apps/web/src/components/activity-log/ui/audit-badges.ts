// apps/web/src/components/activity-log/ui/audit-badges.ts
// Maps an audit category to a Badge variant + label, mirroring the App Logs page's
// getLogTypeBadge. Single source of truth so both the org and super-admin views agree.

import { AUDIT_CATEGORY_LABELS, type AuditCategory } from '@auxx/lib/audit-log/client'
import type { Variant } from '@auxx/ui/components/badge'

/** Color-codes a category for the leading row badge. Sensitive categories run hot (red/amber). */
const CATEGORY_VARIANTS: Record<AuditCategory, Variant> = {
  security: 'red',
  auth: 'amber',
  members: 'blue',
  integrations: 'violet',
  settings: 'zinc',
  billing: 'green',
  apps: 'cyan',
  data_export: 'amber',
}

/** Resolve a category string to its `{ variant, label }`. Falls back gracefully for unknown values. */
export function getCategoryBadge(category: string): { variant: Variant; label: string } {
  const known = category as AuditCategory
  return {
    variant: CATEGORY_VARIANTS[known] ?? 'gray',
    label: AUDIT_CATEGORY_LABELS[known] ?? category,
  }
}
