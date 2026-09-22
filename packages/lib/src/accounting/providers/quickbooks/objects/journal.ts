// packages/lib/src/accounting/providers/quickbooks/objects/journal.ts
// The journal object's send/read/withdraw, moved out of
// `quickbooks-accounting-provider.ts` unchanged (plan 67 §5.1) - the four
// idempotency layers documented there still apply verbatim.

import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../../../errors'
import { UnifiedCrudHandler } from '../../../../resources/crud'
import {
  type ExportJournalPayload,
  JOURNAL_OBJECT_TYPE,
  parseExportJournal,
} from '../../../export/payloads/journal'
import { accountLabel } from '../../../ledger/chart/account-label'
import {
  type ChartAccountRow,
  type CounterpartyType,
  ProviderPostError,
  type WithdrawResult,
} from '../../../ledger/types'
import type {
  ProviderObjectContext,
  ReadObjectRef,
  ReadObjectResult,
  SendObjectEcho,
  SendObjectInput,
  SendObjectResult,
  WithdrawObjectInput,
} from '../../provider'
import { readQuickbooksIdField } from '../identity-field'
import type { QuickbooksToolContext } from '../invoke-quickbooks-tool'
import type { BuiltCreate, QuickbooksBatchObject } from '../send-objects'
import { readQuickbooksCustomerFields, upsertQuickbooksCustomer } from '../upsert-customer'
import {
  echoOf,
  errorMessage,
  QUICKBOOKS_PROVIDER_ID,
  recoverOrClassify,
  requireToolInputs,
  resolveMappedAccounts,
} from './shared'

const logger = createScopedLogger('quickbooks-objects-journal')

const TOOL_FIND_JOURNAL_ENTRY = 'find_quickbooks_journal_entry'
const TOOL_CREATE_JOURNAL_ENTRY = 'create_quickbooks_journal_entry'
/** The un-sync half (brief 60 §6). Ships later than the rest - see `requireToolInputs`. */
const TOOL_DELETE_JOURNAL_ENTRY = 'delete_quickbooks_journal_entry'

/** The QuickBooks id-map field for a `contact` synced as a `Customer`. */
const QBO_CUSTOMER_ID_FIELD_KEY = 'qboCustomerId'
/**
 * The QuickBooks id-map field for a `company` synced as a `Vendor`.
 *
 * 🛑 Not provisioned by the app until the first vendor bill entry ships
 * (brief 13 DECIDED, unit 1). Until then `readQuickbooksIdField` returns
 * `undefined` for the field itself rather than for any one vendor, so every
 * payable line refuses with the "not synced" sentence below - intended
 * behaviour, not a bug in this file.
 */
const QBO_VENDOR_ID_FIELD_KEY = 'qboVendorId'

/** What `resolveOrCreateCounterparties` resolves one line's counterparty TO. */
interface QuickbooksEntity {
  type: 'Customer' | 'Vendor'
  id: string
  name?: string
}

/** `'customer:contact_1'` / `'vendor:company_1'` - a map key, never persisted. */
function counterpartyKey(type: CounterpartyType, id: string): string {
  return `${type}:${id}`
}

/**
 * One journal entry line in the shape `create_quickbooks_journal_entry` takes.
 * QuickBooks' own vocabulary, local to this file for the same reason the
 * provider file's header gives.
 */
interface QboJournalLine {
  amountMinor: number
  postingType: 'Debit' | 'Credit'
  accountId: string
  accountName?: string
  description?: string
  entity?: { type: 'Customer' | 'Vendor' | 'Employee'; id: string; name?: string }
}

/**
 * Resolve every counterparty a receivable or payable line names to a
 * QuickBooks `entity` reference, **creating the customer when there is not
 * one yet**, and refuse a line that carries no counterparty at all (brief 13
 * §1.3, §1.4; task 23 §1). Moved verbatim - see
 * `quickbooks-accounting-provider.ts`'s prior history for the full argument.
 */
async function resolveOrCreateCounterparties(
  tool: QuickbooksToolContext,
  input: ExportJournalPayload,
  ourChart: readonly ChartAccountRow[]
): Promise<Result<Map<string, QuickbooksEntity>, Error>> {
  const byId = new Map(ourChart.map((row) => [row.id, row]))
  const handler = new UnifiedCrudHandler(tool.organizationId, tool.userId)

  const distinct = new Map<string, { type: CounterpartyType; id: string }>()
  for (const line of input.lines) {
    if (line.counterparty)
      distinct.set(counterpartyKey(line.counterparty.type, line.counterparty.id), line.counterparty)
  }

  const resolved = new Map<string, QuickbooksEntity>()
  const unsynced = new Set<string>()
  const upsertRefusals = new Map<string, string>()

  for (const { type, id } of distinct.values()) {
    const isCustomer = type === 'customer'
    const key = counterpartyKey(type, id)

    const externalId = await readQuickbooksIdField({
      organizationId: tool.organizationId,
      installationId: tool.installationId,
      connectionId: tool.connectionId,
      appFieldKey: isCustomer ? QBO_CUSTOMER_ID_FIELD_KEY : QBO_VENDOR_ID_FIELD_KEY,
      recordId: toRecordId(isCustomer ? 'contact' : 'company', id),
      handler,
    })
    if (externalId) {
      resolved.set(key, { type: isCustomer ? 'Customer' : 'Vendor', id: externalId })
      continue
    }

    if (!isCustomer) {
      unsynced.add(key)
      continue
    }

    try {
      const contactFields = await readQuickbooksCustomerFields(tool.organizationId, id)
      const customerId = await upsertQuickbooksCustomer(tool, {
        organizationId: tool.organizationId,
        contactInstanceId: id,
        contactFields,
        handler,
      })
      resolved.set(key, { type: 'Customer', id: customerId })
    } catch (error) {
      upsertRefusals.set(key, errorMessage(error))
      unsynced.add(key)
      logger.warn('Could not resolve or create a QuickBooks customer for a receivable line', {
        organizationId: tool.organizationId,
        contactInstanceId: id,
        docNumber: input.docNumber,
        error: errorMessage(error),
      })
    }
  }

  const problems = new Set<string>()
  for (const line of input.lines) {
    const account = byId.get(line.glAccountId)
    const subtype = account?.subtype
    if (subtype !== 'accounts_receivable' && subtype !== 'accounts_payable') continue

    const kind = subtype === 'accounts_receivable' ? 'receivable' : 'payable'
    const qbNoun = subtype === 'accounts_receivable' ? 'customer' : 'vendor'
    const ourNoun = subtype === 'accounts_receivable' ? 'contact' : 'company'
    const label = account ? accountLabel(account) : (line.accountCode ?? line.glAccountId)

    if (!line.counterparty) {
      problems.add(
        `${input.docNumber} posts to ${label}, and QuickBooks cannot accept a ${kind} line ` +
          `without a ${qbNoun}. This line carries no ${ourNoun}.`
      )
      continue
    }
    const key = counterpartyKey(line.counterparty.type, line.counterparty.id)
    if (unsynced.has(key)) {
      const refusal = upsertRefusals.get(key)
      problems.add(
        refusal
          ? `${input.docNumber} posts to ${label}. ${refusal}`
          : `${input.docNumber} posts to ${label}, and QuickBooks cannot accept a ${kind} line ` +
              `without a ${qbNoun}. The ${ourNoun} on this line has no ${qbNoun} in QuickBooks ` +
              'and auxx cannot create one for it.'
      )
    }
  }

  if (problems.size > 0) {
    return err(new UnprocessableEntityError([...problems].join(' ')))
  }
  return ok(resolved)
}

/** What QuickBooks holds under one `DocNumber`, or undefined when it holds none. */
async function findExistingEntry(
  tool: QuickbooksToolContext,
  docNumber: string
): Promise<{ externalId: string; syncToken: string | null; echo?: SendObjectEcho } | undefined> {
  const found = await tool.callTool(TOOL_FIND_JOURNAL_ENTRY, { docNumber })
  const entry = found?.journalEntries?.[0] as Record<string, unknown> | undefined
  if (!entry?.journalEntryId) return undefined
  return {
    externalId: String(entry.journalEntryId),
    syncToken: typeof entry.syncToken === 'string' ? entry.syncToken : null,
    echo: echoOf(entry),
  }
}

function parse(raw: Record<string, unknown>): Result<ExportJournalPayload, Error> {
  try {
    return ok(parseExportJournal(raw))
  } catch (error) {
    return err(
      new ProviderPostError(`The frozen export payload is not a journal: ${errorMessage(error)}`, {
        failureClass: 'data',
        providerId: QUICKBOOKS_PROVIDER_ID,
      })
    )
  }
}

/** Accounts and counterparties, resolved into `create_quickbooks_journal_entry`'s input minus `requestId`. */
async function build(
  tool: QuickbooksToolContext,
  _ctx: ProviderObjectContext,
  journal: ExportJournalPayload
): Promise<Result<BuiltCreate, Error>> {
  const accounts = await resolveMappedAccounts(
    tool,
    journal.lines.map((line) => line.glAccountId)
  )
  if (accounts.isErr()) return err(accounts.error)

  const counterparties = await resolveOrCreateCounterparties(tool, journal, accounts.value.chart)
  if (counterparties.isErr())
    return err(
      new ProviderPostError(counterparties.error.message, {
        failureClass: 'configuration',
        providerId: QUICKBOOKS_PROVIDER_ID,
      })
    )

  const lines: QboJournalLine[] = []
  for (const line of [...journal.lines].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const account = accounts.value.accounts.get(line.glAccountId)
    if (!account) continue
    lines.push({
      amountMinor: line.amountMinor,
      postingType: line.direction === 'debit' ? 'Debit' : 'Credit',
      accountId: account.id,
      accountName: account.fullyQualifiedName,
      ...(line.memo && { description: line.memo }),
      ...(line.counterparty && {
        entity: counterparties.value.get(
          counterpartyKey(line.counterparty.type, line.counterparty.id)
        ),
      }),
    })
  }

  return ok({
    create: {
      lines,
      txnDate: journal.txnDate,
      docNumber: journal.docNumber,
      privateNote: journal.privateNote,
      currency: journal.currency,
    },
  })
}

function answer(tool: QuickbooksToolContext, raw: unknown): Result<SendObjectResult, Error> {
  const entry = (raw as { journalEntry?: Record<string, unknown> } | undefined)?.journalEntry
  if (!entry?.journalEntryId)
    return err(
      new ProviderPostError('QuickBooks returned no journal entry id', {
        failureClass: 'data',
        providerId: QUICKBOOKS_PROVIDER_ID,
      })
    )
  return ok({
    status: 'sent',
    externalId: String(entry.journalEntryId),
    remoteVersion: typeof entry.syncToken === 'string' ? entry.syncToken : null,
    providerId: QUICKBOOKS_PROVIDER_ID,
    ...(tool.realmId && { tenantId: tool.realmId }),
    echo: echoOf(entry),
  })
}

export const batchObject: QuickbooksBatchObject<ExportJournalPayload> = {
  object: JOURNAL_OBJECT_TYPE,
  parse,
  build,
  answer,
  find: {
    listField: 'journalEntries',
    idField: 'journalEntryId',
    docNumber: (journal) => journal.docNumber,
  },
}

/**
 * Create one journal entry in QuickBooks from a frozen, provider-neutral
 * payload. The four idempotency layers are unchanged in substance - see the
 * provider file's header for the full argument.
 */
export async function send(
  tool: QuickbooksToolContext,
  ctx: ProviderObjectContext,
  input: SendObjectInput
): Promise<Result<SendObjectResult, Error>> {
  const organizationId = ctx.organizationId
  const parsed = parse(input.payload)
  if (parsed.isErr()) return err(parsed.error)
  const docNumber = parsed.value.docNumber

  try {
    const built = await build(tool, ctx, parsed.value)
    if (built.isErr()) return err(built.error)
    if ('settled' in built.value) return ok(built.value.settled)

    const existing = await findExistingEntry(tool, docNumber)
    if (existing) {
      logger.warn('QuickBooks already holds this DocNumber - adopting, not re-posting', {
        organizationId,
        docNumber,
        providerEntryId: existing.externalId,
      })
      return ok({
        status: 'already_exists',
        externalId: existing.externalId,
        remoteVersion: existing.syncToken,
        providerId: QUICKBOOKS_PROVIDER_ID,
        ...(tool.realmId && { tenantId: tool.realmId }),
        echo: existing.echo,
      })
    }

    const created = await tool.callTool(TOOL_CREATE_JOURNAL_ENTRY, {
      ...built.value.create,
      requestId: input.idempotencyKey,
    })
    const result = answer(tool, created)
    if (result.isOk())
      logger.info('Journal entry created in QuickBooks', {
        organizationId,
        docNumber,
        providerEntryId: result.value.externalId,
        lineCount: (built.value.create.lines as unknown[]).length,
      })
    return result
  } catch (error) {
    return recoverOrClassify(
      organizationId,
      QUICKBOOKS_PROVIDER_ID,
      error,
      async () => {
        const adopted = await findExistingEntry(tool, docNumber)
        return adopted
          ? {
              externalId: adopted.externalId,
              remoteVersion: adopted.syncToken,
              ...(tool.realmId && { tenantId: tool.realmId }),
            }
          : undefined
      },
      { docNumber }
    )
  }
}

/**
 * Read one journal back, by the document number it was sent under.
 *
 * 🛑 A DOCUMENT-NUMBER lookup, not a per-object read: there is no
 * `get_quickbooks_journal_entry`, so this proves the object exists and
 * returns its `SyncToken` but cannot produce a hash of what QuickBooks holds.
 */
export async function read(
  tool: QuickbooksToolContext,
  ref: ReadObjectRef
): Promise<Result<ReadObjectResult, Error>> {
  const absent: ReadObjectResult = {
    status: 'unsupported',
    externalId: ref.externalId,
    remoteVersion: null,
    docNumber: ref.docNumber,
    totalMinor: null,
    payloadHash: null,
  }
  if (!ref.docNumber) return ok(absent)
  if (requireToolInputs(tool, TOOL_FIND_JOURNAL_ENTRY, ['docNumber'])) return ok(absent)
  try {
    const found = await findExistingEntry(tool, ref.docNumber)
    if (!found)
      return ok({
        status: 'gone',
        externalId: ref.externalId,
        remoteVersion: null,
        docNumber: ref.docNumber,
        totalMinor: null,
        payloadHash: null,
      })
    return ok({
      status: 'found',
      externalId: found.externalId,
      remoteVersion: found.syncToken,
      docNumber: ref.docNumber,
      totalMinor: null,
      payloadHash: null,
    })
  } catch (error) {
    return err(
      new UnprocessableEntityError(errorMessage(error), { docNumber: ref.docNumber ?? undefined })
    )
  }
}

/**
 * Remove one journal entry we created, by the id recorded when we created it.
 * Converges on `already_gone`; `remoteVersion` is REQUIRED (Intuit's
 * `SyncToken`) - see the provider file's history on why a fresh re-read here
 * would discard an accountant's edit instead of reporting it.
 */
export async function withdraw(
  tool: QuickbooksToolContext,
  input: WithdrawObjectInput
): Promise<Result<WithdrawResult, Error>> {
  const context = { externalId: input.externalId }

  const notReady = requireToolInputs(tool, TOOL_DELETE_JOURNAL_ENTRY, [
    'journalEntryId',
    'syncToken',
  ])
  if (notReady) return err(new UnprocessableEntityError(notReady, context))

  try {
    const answer = (await tool.callTool(TOOL_DELETE_JOURNAL_ENTRY, {
      journalEntryId: input.externalId,
      syncToken: input.remoteVersion,
    })) as { journalEntryId?: string; status?: string; alreadyGone?: boolean } | undefined

    const alreadyGone = Boolean(answer?.alreadyGone)
    logger.info(
      alreadyGone
        ? 'QuickBooks no longer held the journal entry'
        : 'Journal entry removed from QuickBooks',
      { ...context, status: answer?.status }
    )
    return ok({
      status: alreadyGone ? 'already_gone' : 'withdrawn',
      externalId: answer?.journalEntryId ?? input.externalId,
      providerId: QUICKBOOKS_PROVIDER_ID,
      ...(answer ? { raw: answer as Record<string, unknown> } : {}),
    })
  } catch (error) {
    logger.warn('QuickBooks refused to remove a journal entry', {
      ...context,
      error: errorMessage(error),
    })
    return err(new UnprocessableEntityError(errorMessage(error), context))
  }
}

export { JOURNAL_OBJECT_TYPE }
