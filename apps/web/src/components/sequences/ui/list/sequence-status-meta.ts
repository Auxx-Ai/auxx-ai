// apps/web/src/components/sequences/ui/list/sequence-status-meta.ts

import type { SequenceStatus } from '@auxx/lib/sequences/client'
import type { Variant as BadgeVariant } from '@auxx/ui/components/badge'
import type { ListCardStatusTone } from '@auxx/ui/components/list-card'

/** Corner-dot tone + footer badge variant/label per sequence status. */
export const SEQUENCE_STATUS_META: Record<
  SequenceStatus,
  { tone: ListCardStatusTone; badgeVariant: BadgeVariant; label: string }
> = {
  draft: { tone: 'muted', badgeVariant: 'gray', label: 'Draft' },
  enabled: { tone: 'good', badgeVariant: 'green', label: 'Enabled' },
  disabled: { tone: 'warning', badgeVariant: 'amber', label: 'Disabled' },
}
