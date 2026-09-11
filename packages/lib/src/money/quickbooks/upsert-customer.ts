// packages/lib/src/money/quickbooks/upsert-customer.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../errors'
import type { UnifiedCrudHandler } from '../../resources/crud'
import { CONTACT_FIELDS } from '../../resources/registry/resources/contact-fields'
import { readQuickbooksIdField, writeQuickbooksIdField } from './identity-field'
import type { QuickbooksToolContext } from './invoke-quickbooks-tool'

const logger = createScopedLogger('quickbooks-upsert-customer')

const QBO_CUSTOMER_ID_FIELD_KEY = 'qboCustomerId'

/**
 * Intuit's fault code for a `DisplayName` that is already taken.
 * `create_quickbooks_customer`'s own tool description names it.
 */
const DUPLICATE_NAME_FAULT = '6240'

/** How many characters of the contact id the last-resort label carries. */
const ID_SUFFIX_LENGTH = 6

/**
 * The `CustomField.systemAttribute` values a customer is built from.
 *
 * These, not the registry field KEYS: see {@link readQuickbooksCustomerFields}
 * for why the difference is load-bearing.
 *
 * 🛑 Read off the registry rather than spelled here, so a rename cannot leave
 * four string literals behind pointing at attributes no field carries any more.
 * That failure would be silent: the join returns nothing, every contact looks
 * nameless, and every receivable refuses its own export.
 */
const CONTACT_FIRST_NAME = CONTACT_FIELDS.firstName?.systemAttribute ?? 'first_name'
const CONTACT_LAST_NAME = CONTACT_FIELDS.lastName?.systemAttribute ?? 'last_name'
const CONTACT_PRIMARY_EMAIL = CONTACT_FIELDS.primaryEmail?.systemAttribute ?? 'primary_email'
const CONTACT_COMPANY = CONTACT_FIELDS.company?.systemAttribute ?? 'contact_company'

/** The forensic mark auxx writes on a customer it created. See {@link customerStamp}. */
export function customerStamp(contactInstanceId: string): string {
  return `auxx:contact:${contactInstanceId}`
}

/** The contact facts a customer is built from. All optional; none is guaranteed. */
export interface QuickbooksCustomerFields {
  firstName?: string
  lastName?: string
  primaryEmail?: string
  /** The contact's company NAME, already resolved. Only used by label rung 3. */
  companyName?: string
}

export interface UpsertQuickbooksCustomerInput {
  organizationId: string
  contactInstanceId: string
  contactFields: QuickbooksCustomerFields
  handler: UnifiedCrudHandler
}

/** One QuickBooks customer, as the find/create tools hand it back. */
interface ToolCustomer {
  customerId: string
  displayName?: string
  email?: string | null
  notes?: string | null
  active?: boolean
}

/** What the decision table in {@link classifyNameMatch} concluded. */
type NameMatchVerdict = 'adopt' | 'different-person' | 'unknowable'

/** Case- and whitespace-insensitive compare, so ' Jane@Example.com ' matches. */
function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/**
 * Find-or-create the QuickBooks `Customer` for one auxx contact, and write the
 * id back.
 *
 * Called from the EXPORT, by `resolveOrCreateCounterparties`, at the moment a
 * receivable line needs a customer (plans/accounting/tasks/23 section 1).
 * QuickBooks cannot accept an A/R line without one, so this is a prerequisite
 * of the entry rather than a side effect of it.
 *
 * ── The ladder ──────────────────────────────────────────────────────────────
 *
 *   1. the stored `qboCustomerId` (cell, or its `RecordIdentity` mirror)
 *   2. find by exact email
 *   3. find by exact display name
 *   4. create, and on Intuit's 6240 duplicate-name fault, decide (never adopt)
 *
 * Each layer covers a window the next cannot, and every layer that resolves an
 * id writes it back before returning - a resolve that does not persist is a
 * resolve that will run again.
 *
 * ── 🛑 Identity is the EMAIL. The name is only a label. ──────────────────────
 *
 * The one sentence that keeps someone from "fixing" one half of this by
 * breaking the other:
 *
 *   - **Same email, two contacts** resolve to ONE customer. They are one person
 *     and their A/R should aggregate.
 *   - **Same name, different emails** resolve to TWO customers. They are two
 *     people, and the collision is in the LABEL.
 *
 * So a label collision is resolved by CHANGING THE LABEL, never by merging the
 * records. `John Smith` twice in an address book is not an edge case, it is
 * Tuesday, and adopting the first Smith for the second would merge two people's
 * receivables under one customer. That balances, the aging still foots, and
 * nothing downstream can detect it - the same failure class
 * `suggest-account-identities.ts` refuses to risk on accounts.
 *
 * ⚠️ **Renames are deliberately NOT chased.** Once layer 1 has an id it
 * short-circuits forever, so a contact renamed in auxx keeps its old
 * QuickBooks `DisplayName` and the two drift. That is consistent with frozen
 * attribution, and a rename that rewrote history in somebody's books would be
 * worse than a stale name. The drift is not a bug; do not file it as one.
 *
 * @throws {UnprocessableEntityError} when no customer can be resolved safely -
 *   the contact has nothing to build a name from, or a same-named customer
 *   cannot be told apart from a stranger. The caller collects these rather than
 *   failing on the first, because fixing an export one refused post at a time is
 *   how a close slips a day.
 */
export async function upsertQuickbooksCustomer(
  ctx: QuickbooksToolContext,
  input: UpsertQuickbooksCustomerInput
): Promise<string> {
  const { organizationId, contactInstanceId, contactFields, handler } = input
  const contactRecordId = toRecordId('contact', contactInstanceId)

  // ── Layer 1: the stored id ────────────────────────────────────────────────
  const stored = await readQuickbooksIdField({
    organizationId,
    installationId: ctx.installationId,
    connectionId: ctx.connectionId,
    appFieldKey: QBO_CUSTOMER_ID_FIELD_KEY,
    recordId: contactRecordId,
    handler,
  })
  if (stored) return stored

  const email = contactFields.primaryEmail?.trim() || undefined
  const labels = buildDisplayNames(contactInstanceId, contactFields)
  if (labels.length === 0) {
    throw new UnprocessableEntityError(
      `The contact on this line (${contactInstanceId}) has no name and no email, so no QuickBooks customer can be created for it. Give the contact a name or an email address.`,
      { organizationId, contactInstanceId }
    )
  }

  const write = async (customerId: string): Promise<string> => {
    await writeQuickbooksIdField({
      organizationId,
      installationId: ctx.installationId,
      connectionId: ctx.connectionId,
      appFieldKey: QBO_CUSTOMER_ID_FIELD_KEY,
      entityType: 'contact',
      entityInstanceId: contactInstanceId,
      externalId: customerId,
      userId: ctx.userId,
    })
    return customerId
  }

  // ── Layer 2: find by email ────────────────────────────────────────────────
  //
  // The strongest evidence there is, and the only one that means "same person"
  // on its own. Two auxx contacts sharing an email land on one customer here,
  // which is the accepted outcome (task 23 section 4.3).
  if (email) {
    const found = await findCustomer(ctx, { email })
    if (found) {
      assertUsable(found, organizationId, contactInstanceId)
      logger.debug('Resolved a QuickBooks customer by email', {
        organizationId,
        contactInstanceId,
        customerId: found.customerId,
      })
      return write(found.customerId)
    }
  }

  // ── Layers 3 and 4: walk the label ladder ─────────────────────────────────
  //
  // Each rung is tried in full - look, then create - before the next is
  // considered, and a rung is only abandoned when the name it wants belongs to
  // somebody else.
  for (const [index, displayName] of labels.entries()) {
    const isLastRung = index === labels.length - 1

    // Layer 3. A name match is NOT proof, so it goes through the same decision
    // table the 6240 recovery uses. This arm used to be absent entirely, which
    // meant an emailless contact created a customer on every single attempt.
    const existing = await findCustomer(ctx, { displayName })
    if (existing) {
      const verdict = classifyNameMatch(existing, { email, contactInstanceId })
      if (verdict === 'adopt') {
        assertUsable(existing, organizationId, contactInstanceId)
        return write(existing.customerId)
      }
      if (verdict === 'unknowable') {
        throw sameNameRefusal(existing, displayName, organizationId, contactInstanceId)
      }
      // 'different-person': the label is taken by somebody else. Relabel.
      if (isLastRung) throw exhaustedRefusal(displayName, organizationId, contactInstanceId)
      continue
    }

    // Layer 4. Create, and treat 6240 as a question rather than an answer.
    try {
      const created = await createCustomer(ctx, displayName, contactInstanceId, contactFields)
      logger.debug('Created a QuickBooks customer', {
        organizationId,
        contactInstanceId,
        customerId: created.customerId,
        displayName,
      })
      return write(created.customerId)
    } catch (error) {
      if (!isDuplicateNameFault(error)) throw error

      // 🛑 Two different things produce 6240 and the fault alone cannot tell
      // them apart: OUR OWN RACE (a concurrent export of the same contact
      // created it a moment ago) and A COLLISION (a different person with the
      // same name). Re-query and adopt the winner is right for the first and
      // catastrophic for the second. Ask who it is.
      const winner = await findCustomer(ctx, { displayName })
      if (!winner) {
        // The name was taken when we posted and free when we looked. Nothing
        // stable to reason about, so try the next label rather than guess.
        if (isLastRung) throw error
        continue
      }

      const verdict = classifyNameMatch(winner, { email, contactInstanceId })
      if (verdict === 'adopt') {
        assertUsable(winner, organizationId, contactInstanceId)
        logger.debug('Recovered from a 6240 duplicate-name fault', {
          organizationId,
          contactInstanceId,
          customerId: winner.customerId,
        })
        return write(winner.customerId)
      }
      if (verdict === 'unknowable') {
        throw sameNameRefusal(winner, displayName, organizationId, contactInstanceId)
      }
      if (isLastRung) throw exhaustedRefusal(displayName, organizationId, contactInstanceId)
    }
  }

  throw exhaustedRefusal(labels[labels.length - 1] ?? '', organizationId, contactInstanceId)
}

/**
 * Is the customer found under our name actually ours?
 *
 * The decision table from task 23 section 2.4. Read it as four rows, because
 * every one of them is a different real situation:
 *
 * | what we see | what it is | verdict |
 * | --- | --- | --- |
 * | its email equals ours | the same person | `adopt` |
 * | its notes carry our stamp | our own race | `adopt` |
 * | it has an email, and it is not ours | a different person | `different-person` |
 * | no email, no stamp | unknowable | `unknowable` |
 *
 * 🛑 The last row is a REFUSAL and must stay one. A customer the firm typed in
 * by hand, with a common name and no email, cannot be told apart from a
 * stranger by anything we hold - and guessing there is the entire problem this
 * function exists to avoid.
 *
 * ⚠️ The stamp arm only works because auxx stamps on CREATE ONLY (task 23
 * section 3, MK's Q2). An absent stamp therefore means "not ours", never "not
 * checked". If stamping is ever extended to customers we merely FOUND, this
 * table has to be revisited in the same change or the second row starts lying.
 */
function classifyNameMatch(
  found: ToolCustomer,
  ours: { email?: string; contactInstanceId: string }
): NameMatchVerdict {
  const theirEmail = norm(found.email)
  const ourEmail = norm(ours.email)

  if (theirEmail && ourEmail && theirEmail === ourEmail) return 'adopt'
  if (found.notes?.includes(customerStamp(ours.contactInstanceId))) return 'adopt'

  // An email that is not ours is positive evidence of a different person. That
  // includes the case where we have none: we cannot claim a record that carries
  // somebody else's address.
  if (theirEmail) return 'different-person'

  return 'unknowable'
}

/**
 * Every `DisplayName` this contact could take, best first.
 *
 * The label is what the firm reads on the A/R aging, on statements and in every
 * report, so it has to stay human before it stays unique:
 *
 *   1. `First Last`
 *   2. collided and there is an email  -> `First Last (email)`
 *   3. collided and there is not       -> `First Last (Company)`
 *   4. collided and neither            -> `First Last (a1b2c3)`
 *
 * With no name at all the email stands alone as the label; with neither the
 * list is EMPTY and the caller refuses.
 *
 * 🛑 **Disambiguate on collision, do not pre-disambiguate everything.** Stamping
 * `(jane@acme.com)` onto every customer forever, to pre-empt a clash most names
 * never have, makes every report the accountant reads worse in order to solve a
 * minority case.
 *
 * ⚠️ **Every rung is a pure function of the CONTACT, never of a counter.**
 * `John Smith 2` would be unstable - which Smith is `2` depends on who exported
 * first - so the name would not be reproducible and the find-by-name arm would
 * go looking for a string only one particular ordering could have produced.
 *
 * Order-dependence survives anyway and is fine: the first Smith to export takes
 * the plain name and the second carries a suffix, which is not reproducible from
 * the contact alone. It does not need to be. Once either is created its id is
 * stored and layer 1 short-circuits forever, so the worst case is one extra
 * round trip through 6240 on a first attempt. That is a cost, not a bug.
 */
function buildDisplayNames(contactInstanceId: string, fields: QuickbooksCustomerFields): string[] {
  const name = [fields.firstName, fields.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
    .trim()
  const email = fields.primaryEmail?.trim()
  const company = fields.companyName?.trim()

  const base = name || email
  if (!base) return []

  const labels = [base]

  // Rung 2 or 3, never both: the email is the better discriminator when it
  // exists, and a customer carrying both would just be noisier.
  if (email && base !== email) labels.push(`${base} (${email})`)
  else if (company) labels.push(`${base} (${company})`)

  // Rung 4, the backstop that guarantees this terminates. Contact ids are
  // unique, so a label carrying one cannot collide with another contact's.
  labels.push(`${base} (${contactInstanceId.slice(-ID_SUFFIX_LENGTH)})`)

  return labels
}

/** One `find_quickbooks_customer` call. Null when nothing matched. */
async function findCustomer(
  ctx: QuickbooksToolContext,
  by: { email: string } | { displayName: string }
): Promise<ToolCustomer | null> {
  const result = await ctx.callTool('find_quickbooks_customer', by)
  if (!result?.found || !result.customer?.customerId) return null
  return { ...result.customer, customerId: String(result.customer.customerId) }
}

/**
 * One `create_quickbooks_customer` call, carrying the forensic stamp.
 *
 * 🛑 The stamp goes on CREATE ONLY. We never touch the `Notes` of a customer the
 * firm owns, which is what lets {@link classifyNameMatch} read an absent stamp
 * as "not ours".
 *
 * ⚠️ `Notes` is not filterable in QQL, so nothing may ever resolve a customer BY
 * this value - the same argument `postEntry` makes about `PrivateNote`, which is
 * why `DocNumber` and not the note carries the journal lookup. It is read off a
 * record already found another way.
 */
async function createCustomer(
  ctx: QuickbooksToolContext,
  displayName: string,
  contactInstanceId: string,
  fields: QuickbooksCustomerFields
): Promise<ToolCustomer> {
  const created = await ctx.callTool('create_quickbooks_customer', {
    displayName,
    ...(fields.firstName ? { givenName: fields.firstName } : {}),
    ...(fields.lastName ? { familyName: fields.lastName } : {}),
    ...(fields.companyName ? { companyName: fields.companyName } : {}),
    ...(fields.primaryEmail ? { email: fields.primaryEmail } : {}),
    notes: customerStamp(contactInstanceId),
  })
  return { ...created, customerId: String(created.customerId) }
}

/**
 * Refuse a customer that cannot receive a posting.
 *
 * QuickBooks does not hard-delete a `Customer`, it sets `Active: false`, and a
 * journal entry naming an inactive one is rejected. Catch it here, where the
 * message can name the customer, rather than letting Intuit reject the whole
 * entry with its own wording.
 *
 * 🛑 We do NOT reactivate it. That is an edit to their books nobody asked for.
 *
 * ⚠️ This checks customers resolved on THIS pass only. The layer-1 fast path
 * deliberately does not re-fetch a stored customer to check it, because that
 * would spend a round trip on every resolve to catch a state that Intuit
 * reports anyway when the entry is posted.
 */
function assertUsable(
  customer: ToolCustomer,
  organizationId: string,
  contactInstanceId: string
): void {
  if (customer.active === false) {
    throw new UnprocessableEntityError(
      `The QuickBooks customer '${customer.displayName ?? customer.customerId}' has been made inactive, and QuickBooks will not accept a receivable line for an inactive customer. Reactivate it in QuickBooks, then retry the export.`,
      { organizationId, contactInstanceId, customerId: customer.customerId }
    )
  }
}

/** The section 2.4 row-four refusal: a same-named customer we cannot identify. */
function sameNameRefusal(
  found: ToolCustomer,
  displayName: string,
  organizationId: string,
  contactInstanceId: string
): UnprocessableEntityError {
  return new UnprocessableEntityError(
    `QuickBooks already has a customer called '${displayName}' (id ${found.customerId}) with no email address and no mark from auxx, so it cannot be told apart from the contact on this line. Add an email to one of them, or link them by hand, and retry the export.`,
    { organizationId, contactInstanceId, customerId: found.customerId }
  )
}

/** Every label the contact could take is spoken for. Vanishingly rare, real. */
function exhaustedRefusal(
  displayName: string,
  organizationId: string,
  contactInstanceId: string
): UnprocessableEntityError {
  return new UnprocessableEntityError(
    `Every name auxx could give this contact in QuickBooks is already taken by a different customer, including '${displayName}'. Rename the conflicting customer in QuickBooks, then retry the export.`,
    { organizationId, contactInstanceId }
  )
}

/** Does this failure carry Intuit's duplicate-`DisplayName` fault? */
function isDuplicateNameFault(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes(DUPLICATE_NAME_FAULT) ||
    /duplicate name|name supplied already exists|must be unique/i.test(message)
  )
}

/**
 * The four contact facts a customer is built from, read in one go.
 *
 * Lives here rather than in the adapter because the shape it produces is this
 * module's input, and a caller assembling it by hand would be a second place
 * that has to know which fields matter.
 *
 * 🛑 **Resolved by `systemAttribute`, NOT by the registry key.** A field's
 * registry `id` (`firstName`) is a brand cast over a plain string, but
 * `FieldValue.fieldId` holds the org's own generated `CustomField` id
 * (`pfofjb1056shi8x5lwm88nry`), and the two are unrelated. Asking for the
 * registry key returns NOTHING, which would make every contact look nameless
 * and refuse its own export. Verified against real rows on 2026-09-11; the
 * registry declares `first_name`, `last_name`, `primary_email` and
 * `contact_company` as the system attributes to join on.
 *
 * Reads `FieldValue` directly rather than through a `UnifiedCrudHandler` for the
 * reason `account-map.ts` gives beside its own direct read: this is one question
 * about one record, and the handler's per-record path would resolve a definition
 * and a field set to answer it.
 *
 * `company` is a RELATIONSHIP (`contact_company`, has_many reverse), not a text
 * column, so the name costs one more lookup. It feeds label rung 3 only, and
 * rung 3 only fires on a name collision when there is no email, so every failure
 * there degrades to rung 4 and nothing is lost. Hence the soft failure.
 */
export async function readQuickbooksCustomerFields(
  organizationId: string,
  contactInstanceId: string
): Promise<QuickbooksCustomerFields> {
  const rows = await database
    .select({
      systemAttribute: schema.CustomField.systemAttribute,
      valueText: schema.FieldValue.valueText,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, contactInstanceId),
        inArray(schema.CustomField.systemAttribute, [
          CONTACT_FIRST_NAME,
          CONTACT_LAST_NAME,
          CONTACT_PRIMARY_EMAIL,
          CONTACT_COMPANY,
        ])
      )
    )

  const text = (attribute: string): string | undefined =>
    rows.find((row) => row.systemAttribute === attribute)?.valueText?.trim() || undefined

  const fields: QuickbooksCustomerFields = {
    firstName: text(CONTACT_FIRST_NAME),
    lastName: text(CONTACT_LAST_NAME),
    primaryEmail: text(CONTACT_PRIMARY_EMAIL),
  }

  const companyId = rows.find((row) => row.systemAttribute === CONTACT_COMPANY)?.relatedEntityId
  if (companyId) {
    const companyName = await readCompanyName(organizationId, companyId)
    if (companyName) fields.companyName = companyName
  }

  return fields
}

/** The display name of the company a contact is linked to. Soft-fails. */
async function readCompanyName(
  organizationId: string,
  companyInstanceId: string
): Promise<string | undefined> {
  try {
    const row = await database.query.EntityInstance.findFirst({
      where: and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.id, companyInstanceId)
      ),
      columns: { displayName: true },
    })
    return row?.displayName?.trim() || undefined
  } catch (error) {
    logger.debug('Could not read the contact company name for the label ladder', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
