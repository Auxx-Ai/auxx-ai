// apps/web/src/components/accounting/ui/ledger/outbox/outbox-tabs.ts

import type { OutboxTab } from '@auxx/lib/accounting/export/client'
import { CheckCheck, CheckCircle2, CircleAlert } from 'lucide-react'

export const TAB_ICON: Record<OutboxTab, typeof CheckCircle2> = {
  blocked: CircleAlert,
  ready: CheckCircle2,
  sent: CheckCheck,
  failed: CircleAlert,
}

export const TAB_LABEL: Record<OutboxTab, string> = {
  blocked: 'Blocked',
  ready: 'Ready',
  sent: 'Sent',
  failed: 'Failed',
}

/** Every panel's list padding, which `SelectAllCheckbox` aligns its box against. */
export const OUTBOX_LIST_PADDING = 12
