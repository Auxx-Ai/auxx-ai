// apps/web/src/components/permissions/ui/record-request-access-popover.tsx
'use client'

import { useState } from 'react'
import { useRecordRequestAccess } from '../hooks/use-record-request-access'
import { type RequestAccessCopy, RequestAccessPopover as Shell } from './request-access-popover'

/**
 * "Sarah Chen (administrator)" / "Sarah Chen and 2 others (administrators)".
 *
 * One noun, because D3 made the approver set a constant: org ADMIN + OWNER, with
 * the thread resolver's row-`admin` rule deleted. There is no `approversAre`
 * discriminator on the record preflight for the same reason.
 */
function approverSummary(approvers: Array<{ name: string | null }>): string | null {
  if (approvers.length === 0) return null
  const first = approvers[0]?.name ?? 'A teammate'
  const noun = approvers.length > 1 ? 'administrators' : 'administrator'
  const rest = approvers.length - 1
  return rest > 0 ? `${first} and ${rest} other ${noun}` : `${first} (${noun})`
}

/**
 * Ask for the next rung on one record (plan v3/04 §8).
 *
 * The chrome is `permissions/ui/request-access-popover.tsx`, shared with the mail
 * lane. What stays here is the record vocabulary the shell must not know: the
 * "administrator" noun and the rung-derived trigger label.
 *
 * **The label follows the ladder, not a picker.** `none → "Request access"`,
 * `read → "Request edit access"`; `edit`/`admin` render nothing at all because
 * there is nothing left to ask for (`admin` is deliberately unrequestable — D1 /
 * §3.2). The mutation carries no rung; the server derives it and re-derives it
 * again at the decision, so this string can only mis-word a button.
 *
 * **No `footer`.** Records have no `AccessLevelsGuide` equivalent, and the shell
 * switches `justify-between` → `justify-end` when the slot is empty so Send/Cancel
 * do not left-align.
 */
export function RecordRequestAccessPopover({
  entityDefinitionId,
  entityInstanceId,
  variant = 'inline',
  assumeNoAccess = false,
}: {
  entityDefinitionId: string
  entityInstanceId: string
  /**
   * `inline` is the detail-page action row, `icon` the drawer header's lock slot,
   * `menu-item` the table row's kebab menu.
   */
  variant?: 'inline' | 'icon' | 'menu-item'
  /**
   * Treat the viewer as holding nothing on this record — the full-page not-found
   * mount, where the row is not in the store and the def fallback would answer
   * for a record the member demonstrably cannot reach (§8.3).
   */
  assumeNoAccess?: boolean
}) {
  // Owned here, not in the shell, because it is the LAZY-PREFLIGHT gate: the
  // hook only issues its query while the popover is open (§8.5 / D6).
  const [open, setOpen] = useState(false)

  const {
    currentRung,
    eligible,
    refusalCopy,
    pending,
    approvers,
    subjectLabel,
    send,
    withdraw,
    isSending,
    isWithdrawing,
  } = useRecordRequestAccess({ entityDefinitionId, entityInstanceId, open, assumeNoAccess })

  const copy: RequestAccessCopy = {
    trigger: currentRung === 'none' ? 'Request access' : 'Request edit access',
    pendingTrigger: 'Access requested',
    notePlaceholder: 'Why do you need access?',
  }

  return (
    <Shell
      eligible={eligible}
      refusalCopy={refusalCopy}
      pending={pending}
      approvers={approvers}
      approverSummary={approverSummary(approvers)}
      subjectLabel={subjectLabel}
      send={send}
      withdraw={withdraw}
      isSending={isSending}
      isWithdrawing={isWithdrawing}
      copy={copy}
      variant={variant}
      onOpenChange={setOpen}
    />
  )
}
