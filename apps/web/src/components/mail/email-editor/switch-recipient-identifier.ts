// apps/web/src/components/mail/email-editor/switch-recipient-identifier.ts

import type { IdentifierType } from '@auxx/database/types'
import type { Recipients } from './types'

/**
 * Swap ONE chip's identifier for another address of the same person, in place.
 *
 * 🔴 **In place, not remove-then-add.** The chip keeps its `id`, its field and
 * its index in that field. Remove-then-add would move it to the end of the list
 * and drop focus, and — because `upsertRecipient` dedupes on `identifier` — the
 * add would silently no-op whenever the target address was already committed
 * somewhere in the same field, costing the user a recipient they still see
 * nothing about.
 *
 * `name` and `recordId` are carried over untouched: the address changed, the
 * person did not.
 *
 * Extracted as a pure function so the position/identity contract is testable
 * without mounting the whole composer — the same reason `derive-initial.ts` and
 * `reconcile-channel-switch.ts` are pure.
 *
 * Returns the SAME `Recipients` object when nothing changes (unknown chip, or
 * the address is already the committed one), so a no-op switch cannot re-render
 * the field or mark the draft dirty a second time.
 */
export function switchRecipientIdentifier(
  recipients: Recipients,
  role: keyof Recipients,
  id: string,
  next: { identifier: string; identifierType: IdentifierType }
): Recipients {
  const list = recipients[role]
  const index = list.findIndex((r) => r.id === id)
  const current = list[index]
  if (!current) return recipients
  if (current.identifier === next.identifier) return recipients
  // Belt to the menu's braces: the row for an address already committed in this
  // field renders disabled, so this is reachable only if the two ever disagree —
  // and collapsing two chips into one is not what "switch" means.
  if (list.some((r) => r.id !== id && r.identifier === next.identifier)) return recipients

  const updated = [...list]
  updated[index] = {
    ...current,
    identifier: next.identifier,
    identifierType: next.identifierType,
  }
  return { ...recipients, [role]: updated }
}
