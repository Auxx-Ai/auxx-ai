// packages/lib/src/returns/intake/group.ts

/**
 * Step 3 (plans/money/tasks/57 §5): labels → returns.
 *
 * 🔑 **Pure. No database, no clock, no ids from outside.** This is where the
 * customer/order semantics actually live, and every rule below is a decision a
 * test can pin rather than a query result. `files/folders/tree.ts` is the model.
 *
 * ## The three rules, and why each one is a rule and not an accident
 *
 * 1. **The group key is `(confirmedContact, confirmedOrder)`.** One customer
 *    returning against two orders is TWO groups, because the order is the real
 *    grain: a return links to one order and its lines come from that order's
 *    shipped lines (§5.2). Collapsing them would put one physical event's
 *    parcels against the wrong order's returnable ceiling.
 *
 * 2. **A label that resolved to nothing gets its OWN group.** Two unidentified
 *    pallets are not one return merely because both are unidentified — that is
 *    grouping on the absence of information, and it is the one merge nobody can
 *    see and nobody can undo (§5.1).
 *
 * 3. **An undecided label is not grouped at all.** `confirmedContactRecordId`
 *    null with `confirmedUnidentified` false means the worker has not answered
 *    yet, and §5.3 forbids grouping on the ladder's guesses: a single wrong
 *    candidate would silently merge two customers' parcels *before* anyone
 *    looked at it. Excluded here, so the review screen's "3 labels → 2 returns"
 *    can only ever count answers.
 */

import type { ReturnIntakeGroup, ReturnIntakeLabel } from './client'

/**
 * The separator inside a derived group id.
 *
 * 🛑 Not `:` — a `RecordId` IS `defId:instanceId` (`@auxx/types/resource`), so a
 * colon here would make `group:def:inst:def:inst` ambiguous to anything that
 * ever tries to read the key back out.
 */
const ID_SEPARATOR = '|'

/** Prefix for a group keyed on a confirmed customer. */
const IDENTIFIED_PREFIX = 'grp'

/** Prefix for a group that is one unidentified label and nothing else. */
const UNIDENTIFIED_PREFIX = 'unid'

/**
 * Whether the worker has answered this label at all.
 *
 * `confirmedUnidentified` is an ANSWER ("this sender is not one of ours", §4.6)
 * and `confirmedContactRecordId === null` on its own is not — the distinction
 * `client.ts` spells out, and rule 3 above is the only place it matters.
 */
function isDecided(label: ReturnIntakeLabel): boolean {
  return label.confirmedUnidentified || label.confirmedContactRecordId !== null
}

/**
 * Group confirmed labels into the returns that will be created.
 *
 * Groups come back in the order their first label was uploaded, and each
 * group's `labelIds` are in upload order too, so the review screen renders the
 * same list twice in a row. Ids are derived from the key, never generated, so a
 * re-render — or a second call after one more label is confirmed — keeps React's
 * keys pointing at the same rows.
 *
 * @param labels every label in the draft, in upload order
 * @returns one entry per `return` to create; undecided labels appear in none
 */
export function groupLabels(labels: ReturnIntakeLabel[]): ReturnIntakeGroup[] {
  const groups: ReturnIntakeGroup[] = []
  const byKey = new Map<string, ReturnIntakeGroup>()

  for (const label of labels) {
    if (!isDecided(label)) continue

    // 🛑 `confirmedUnidentified` wins over a contact id that is also set. It is
    // the worker's explicit terminal answer, and a contradictory draft must
    // resolve towards "nobody" rather than towards a customer nobody chose.
    if (label.confirmedUnidentified) {
      groups.push({
        id: `${UNIDENTIFIED_PREFIX}${ID_SEPARATOR}${label.id}`,
        contactRecordId: null,
        orderRecordId: null,
        labelIds: [label.id],
      })
      continue
    }

    const contactRecordId = label.confirmedContactRecordId
    if (contactRecordId === null) continue

    const orderRecordId = label.confirmedOrderRecordId
    const key = [IDENTIFIED_PREFIX, contactRecordId, orderRecordId ?? ''].join(ID_SEPARATOR)

    const existing = byKey.get(key)
    if (existing) {
      existing.labelIds.push(label.id)
      continue
    }

    const group: ReturnIntakeGroup = {
      id: key,
      contactRecordId,
      orderRecordId,
      labelIds: [label.id],
    }
    byKey.set(key, group)
    groups.push(group)
  }

  return groups
}
