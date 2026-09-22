// packages/lib/src/accounting/providers/quickbooks/objects/shared.ts
// QuickBooks fault classification, the tool-not-deployed guard and the
// duplicate-recovery net every native object's send/read/withdraw shares
// (plan 67 §5.1). Moved out of `quickbooks-accounting-provider.ts` unchanged
// in substance so `objects/journal.ts` and its siblings read off one copy.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../../../errors'
import type { ExportFailureItem } from '../../../export/client'
import { toMinorUnits } from '../../../ledger/builders/manual'
import { accountLabel } from '../../../ledger/chart/account-label'
import { listChartAccounts } from '../../../ledger/roles/role-map'
import {
  type PostFailureClass,
  type ProviderAccount,
  ProviderPostError,
  type WithdrawResult,
} from '../../../ledger/types'
import type {
  ReadObjectRef,
  ReadObjectResult,
  SendObjectResult,
  WithdrawObjectInput,
} from '../../provider'
import { validateProviderMapping } from '../../suggest-account-identities'
import { listQuickbooksProviderAccounts, readQuickbooksAccountMap } from '../account-map'
import type { QuickbooksToolContext } from '../invoke-quickbooks-tool'

const logger = createScopedLogger('quickbooks-objects')

/** The id this adapter registers under. Canonical here so no object file needs a circular import of the provider class. */
export const QUICKBOOKS_PROVIDER_ID = 'quickbooks'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Read QuickBooks' own fault code off a thrown error. See the provider file's own note on why this is duck-typed. */
export function readQuickbooksFaultCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const fault = (error as { quickbooksFault?: { code?: string | null } }).quickbooksFault
  return fault?.code ?? undefined
}

function readStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const status = (error as { statusCode?: unknown }).statusCode
  return typeof status === 'number' ? status : undefined
}

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** Intuit's `Object Not Found` fault - what a converged `get`/`delete` answers on. */
export const OBJECT_NOT_FOUND_FAULT_CODE = '610'

/** True when a thrown error is Intuit's `Object Not Found`, for a `get` tool that does not converge on its own. */
export function isNotFoundFault(error: unknown): boolean {
  return readQuickbooksFaultCode(error) === OBJECT_NOT_FOUND_FAULT_CODE
}

/** Fault codes worth naming; see `quickbooks-accounting-provider.ts`'s own note on why the rest default to `data`. */
const FAULT_CODE_CLASS: Record<string, PostFailureClass> = {
  '2300': 'data',
  [OBJECT_NOT_FOUND_FAULT_CODE]: 'configuration',
  '3100': 'configuration',
  '3200': 'configuration',
}

/** Fault codes meaning "an object with this document number already exists" - re-query and adopt, never re-post. */
export const DUPLICATE_DOC_NUMBER_FAULT_CODES = new Set(['6140', '6240'])

/** Classify a QuickBooks failure into the three classes the export core can act on. */
export function classifyQuickbooksFailure(error: unknown): {
  failureClass: PostFailureClass
  faultCode?: string
} {
  const faultCode = readQuickbooksFaultCode(error)
  if (faultCode && FAULT_CODE_CLASS[faultCode]) {
    return { failureClass: FAULT_CODE_CLASS[faultCode], faultCode }
  }

  const status = readStatusCode(error)
  const code = readErrorCode(error)
  const message = errorMessage(error).toLowerCase()

  if (
    status === 429 ||
    code === 'RATE_LIMIT' ||
    code === 'UPSTREAM_ERROR' ||
    (typeof status === 'number' && status >= 502) ||
    /rate limit|too many requests|timeout|timed out|temporarily unavailable|econnreset|socket hang up/.test(
      message
    )
  ) {
    return { failureClass: 'transport', faultCode }
  }

  if (
    status === 401 ||
    status === 403 ||
    code === 'CONNECTION_EXPIRED' ||
    code === 'CONNECTION_NOT_FOUND' ||
    code === 'CONNECTION_REQUIRED' ||
    code === 'INSUFFICIENT_PERMISSIONS' ||
    /connection expired|reconnect|insufficient permission|not connected/.test(message)
  ) {
    return { failureClass: 'configuration', faultCode }
  }

  return { failureClass: 'data', faultCode }
}

/**
 * Refuse by NAME when the installed deployment's tool cannot take what we are
 * about to send it, rather than calling something that is not there. See
 * `quickbooks-accounting-provider.ts`'s own copy this was moved from.
 */
export function requireToolInputs(
  tool: QuickbooksToolContext,
  toolId: string,
  fields: readonly string[]
): string | null {
  const properties = tool.tools?.find((entry) => entry.id === toolId)?.inputsJsonSchema.properties
  if (!properties || typeof properties !== 'object') {
    return `The installed QuickBooks app has no ${toolId}; update the app deployment first.`
  }
  const missing = fields.filter((field) => !(field in properties))
  if (missing.length === 0) return null
  return `The installed QuickBooks ${toolId} does not support ${missing.join(', ')}; update the app deployment first.`
}

/** What a doc-number-keyed object's "adopt the existing one" recovery found. */
export interface AdoptedObject {
  externalId: string
  remoteVersion: string | null
  tenantId?: string
}

/**
 * The net under a create: before reporting a failure, ask QuickBooks whether
 * it took the object anyway (a duplicate-document-number fault, or a POST that
 * landed but whose response never came back). `findAdopt` is the object's own
 * doc-number lookup - `undefined` for Payment and Deposit, which carry no
 * `DocNumber` and so have no net (plan 67 §5.3/§5.4's own note on the two).
 */
export async function recoverOrClassify(
  organizationId: string,
  providerId: string,
  error: unknown,
  findAdopt: (() => Promise<AdoptedObject | undefined>) | null,
  logContext: Record<string, unknown> = {}
): Promise<Result<SendObjectResult, Error>> {
  const { failureClass, faultCode } = classifyQuickbooksFailure(error)
  const isDuplicate = faultCode !== undefined && DUPLICATE_DOC_NUMBER_FAULT_CODES.has(faultCode)

  if (findAdopt && (isDuplicate || failureClass !== 'configuration')) {
    try {
      const adopted = await findAdopt()
      if (adopted) {
        logger.warn('QuickBooks already held this object - adopting, not re-posting', {
          organizationId,
          ...logContext,
          providerObjectId: adopted.externalId,
          faultCode,
        })
        return ok({
          status: 'already_exists',
          externalId: adopted.externalId,
          remoteVersion: adopted.remoteVersion,
          providerId,
          ...(adopted.tenantId && { tenantId: adopted.tenantId }),
        })
      }
    } catch (recoveryError) {
      logger.debug('Recovery query after a failed create did not complete', {
        organizationId,
        ...logContext,
        error: errorMessage(recoveryError),
      })
    }
  }

  const finalClass: PostFailureClass = isDuplicate ? 'data' : failureClass
  const message = errorMessage(error)
  logger.error('QuickBooks object create failed', {
    organizationId,
    ...logContext,
    failureClass: finalClass,
    faultCode,
    error: message,
  })
  return err(
    new ProviderPostError(message, {
      failureClass: finalClass,
      providerId,
      ...(faultCode && { faultCode }),
    })
  )
}

/** Case- and whitespace-insensitive compare, so ' 1310 ' matches '1310'. */
export function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/**
 * Fetch the org's QuickBooks chart of accounts, active only - a posting
 * cannot use an inactive account. Moved verbatim from
 * `quickbooks-accounting-provider.ts`; see that file's own note on why the
 * chart is fetched whole rather than filtered server-side.
 */
async function fetchChart(tool: QuickbooksToolContext): Promise<ProviderAccount[]> {
  const accounts = await listQuickbooksProviderAccounts(tool)
  return accounts.filter((account) => account.active)
}

/** Names the tab that fixes it: Accounts has two, and the other one is the role mapping (89 D8). */
const UNMAPPED_ACCOUNT_REMEDY =
  'Pick its QuickBooks account under Accounting > Settings > Accounts > Chart of accounts.'
const INVALID_MAPPING_REMEDY =
  'Re-pick its QuickBooks account under Accounting > Settings > Accounts > Chart of accounts.'

/**
 * Resolve every account an entry names, by `glAccountId`, to a QuickBooks
 * account id, through the `G19` account map. Moved verbatim from
 * `quickbooks-accounting-provider.ts` - see that file's history for why this
 * is a confirmed-mapping lookup and never account-number matching.
 */
export async function resolveMappedAccounts(
  tool: QuickbooksToolContext,
  glAccountIds: readonly string[]
): Promise<Result<Map<string, ProviderAccount>, Error>> {
  const [chart, ourChart] = await Promise.all([
    fetchChart(tool),
    listChartAccounts(database, tool.organizationId),
  ])
  if (ourChart.isErr()) return err(ourChart.error)

  const map = await readQuickbooksAccountMap({
    organizationId: tool.organizationId,
    installationId: tool.installationId,
    connectionId: tool.connectionId,
  })

  const byId = new Map(ourChart.value.map((row) => [row.id, row]))
  const byProviderId = new Map(chart.map((account) => [account.id, account]))

  const resolved = new Map<string, ProviderAccount>()
  const problems: string[] = []
  const items: ExportFailureItem[] = []

  for (const glAccountId of new Set(glAccountIds)) {
    const account = byId.get(glAccountId)
    if (!account) {
      // No item: there is nothing to pick for an id the chart does not hold (89 D1).
      problems.push(`No account in this organization's chart has the id '${glAccountId}'.`)
      continue
    }

    const providerAccountId = map.get(account.id)
    if (!providerAccountId) {
      problems.push(
        `${accountLabel(account)} is not mapped to a QuickBooks account. ${UNMAPPED_ACCOUNT_REMEDY}`
      )
      items.push({
        key: 'unmapped_account',
        ref: account.id,
        label: accountLabel(account),
        remedy: UNMAPPED_ACCOUNT_REMEDY,
      })
      continue
    }

    const live = byProviderId.get(providerAccountId)
    const invalid = validateProviderMapping(account, live, providerAccountId)
    if (invalid) {
      problems.push(invalid)
      items.push({
        key: 'invalid_mapping',
        ref: account.id,
        label: accountLabel(account),
        remedy: INVALID_MAPPING_REMEDY,
      })
      continue
    }

    resolved.set(glAccountId, live as ProviderAccount)
  }

  if (problems.length > 0) {
    return err(
      new ProviderPostError(problems.join(' '), {
        failureClass: 'configuration',
        providerId: QUICKBOOKS_PROVIDER_ID,
        items,
      })
    )
  }
  return ok(resolved)
}

/** One doc-number-keyed object as a `find_quickbooks_*` tool answers it. */
export interface FoundByDocNumber {
  externalId: string
  syncToken: string | null
  totalAmt: number | null
}

/**
 * `find_quickbooks_<object>` by `DocNumber` - the layer-2 duplicate check
 * shared by every object that carries one. Payment and Deposit have no such
 * tool (no `DocNumber` in QuickBooks for either) and never call this.
 */
export async function findByDocNumber(
  tool: QuickbooksToolContext,
  findTool: string,
  listField: string,
  idField: string,
  docNumber: string
): Promise<FoundByDocNumber | undefined> {
  const result = await tool.callTool(findTool, { docNumber })
  const list = (result as Record<string, unknown[]> | undefined)?.[listField] ?? []
  const match = list[0] as Record<string, unknown> | undefined
  if (!match || match[idField] == null) return undefined
  return {
    externalId: String(match[idField]),
    syncToken: typeof match.syncToken === 'string' ? match.syncToken : null,
    totalAmt: typeof match.totalAmt === 'number' ? match.totalAmt : null,
  }
}

function goneResult(ref: ReadObjectRef): ReadObjectResult {
  return {
    status: 'gone',
    externalId: ref.externalId,
    remoteVersion: null,
    docNumber: ref.docNumber,
    totalMinor: null,
    payloadHash: null,
  }
}

/**
 * One `get`/`find` answer, in the shape every mapped tool shares
 * (`{ <idField>: ..., docNumber?, totalAmt, syncToken }`), turned into a
 * {@link ReadObjectResult}. `docNumber` is read off the raw answer, never
 * echoed from the ref - Payment and Deposit carry none in QuickBooks, and a
 * null here is what stops `send.ts`'s comparison from inventing a mismatch.
 */
function foundResult(raw: Record<string, unknown>, idField: string): ReadObjectResult {
  const externalId = raw[idField] != null ? String(raw[idField]) : ''
  const docNumber = typeof raw.docNumber === 'string' ? raw.docNumber : null
  const totalAmt = typeof raw.totalAmt === 'number' ? raw.totalAmt : 0
  const syncToken = typeof raw.syncToken === 'string' ? raw.syncToken : null
  return {
    status: 'found',
    externalId,
    remoteVersion: syncToken,
    docNumber,
    totalMinor: toMinorUnits(totalAmt),
    payloadHash: null,
  }
}

/** One native object's `get`/`find` tool ids and field names, for {@link readNativeObject}. */
export interface NativeReadConfig {
  getTool: string
  getIdField: string
  /** Null for Payment and Deposit - neither carries a `DocNumber` to find by. */
  findTool: string | null
  findListField: string | null
  idField: string
}

/**
 * `read` for every native object but the journal (plan 67 §5.3): `get` by
 * `externalId` when there is one, else `find` by `docNumber` when the object
 * carries one, else `gone` - Payment and Deposit have no `find`, so a batch
 * that reaches `read` with neither an id nor a match is reported gone rather
 * than unsupported, exactly as a `get` that came back empty would be.
 */
export async function readNativeObject(
  tool: QuickbooksToolContext,
  ref: ReadObjectRef,
  config: NativeReadConfig
): Promise<Result<ReadObjectResult, Error>> {
  const absent: ReadObjectResult = {
    status: 'unsupported',
    externalId: ref.externalId,
    remoteVersion: null,
    docNumber: ref.docNumber,
    totalMinor: null,
    payloadHash: null,
  }
  try {
    if (ref.externalId) {
      const notReady = requireToolInputs(tool, config.getTool, [config.getIdField])
      if (notReady) return ok(absent)
      try {
        const result = await tool.callTool(config.getTool, { [config.getIdField]: ref.externalId })
        if ((result as { status?: string } | undefined)?.status === 'NotFound') {
          return ok(goneResult(ref))
        }
        return ok(foundResult(result as Record<string, unknown>, config.idField))
      } catch (error) {
        if (isNotFoundFault(error)) return ok(goneResult(ref))
        throw error
      }
    }
    if (ref.docNumber && config.findTool && config.findListField) {
      const notReady = requireToolInputs(tool, config.findTool, ['docNumber'])
      if (notReady) return ok(absent)
      const match = await findByDocNumber(
        tool,
        config.findTool,
        config.findListField,
        config.idField,
        ref.docNumber
      )
      if (!match) return ok(goneResult(ref))
      return ok({
        status: 'found',
        externalId: match.externalId,
        remoteVersion: match.syncToken,
        docNumber: ref.docNumber,
        totalMinor: match.totalAmt !== null ? toMinorUnits(match.totalAmt) : null,
        payloadHash: null,
      })
    }
    return ok(goneResult(ref))
  } catch (error) {
    return err(
      new UnprocessableEntityError(errorMessage(error), {
        docNumber: ref.docNumber ?? undefined,
        externalId: ref.externalId ?? undefined,
      })
    )
  }
}

/** One native object's delete tool id and id field, for {@link withdrawNativeObject}. */
export interface NativeWithdrawConfig {
  deleteTool: string
  idField: string
}

/**
 * `withdraw` for every native object but the journal: `delete_quickbooks_*`
 * with the recorded `SyncToken`, converging on `already_gone`. Every one of
 * these tools shares `deleteQuickbooksEntity`'s answer shape in the apps repo
 * (`{ id, status, alreadyGone, domain }`), unlike the journal's own
 * `journalEntryId`-keyed answer.
 */
export async function withdrawNativeObject(
  tool: QuickbooksToolContext,
  input: WithdrawObjectInput,
  config: NativeWithdrawConfig
): Promise<Result<WithdrawResult, Error>> {
  const context = { externalId: input.externalId, objectType: input.objectType }
  const notReady = requireToolInputs(tool, config.deleteTool, [config.idField, 'syncToken'])
  if (notReady) return err(new UnprocessableEntityError(notReady, context))

  try {
    const answer = (await tool.callTool(config.deleteTool, {
      [config.idField]: input.externalId,
      syncToken: input.remoteVersion,
    })) as { id?: string; status?: string; alreadyGone?: boolean } | undefined

    const alreadyGone = Boolean(answer?.alreadyGone)
    logger.info(
      alreadyGone
        ? `QuickBooks no longer held the ${input.objectType}`
        : 'Object removed from QuickBooks',
      { ...context, status: answer?.status }
    )
    return ok({
      status: alreadyGone ? 'already_gone' : 'withdrawn',
      externalId: answer?.id ?? input.externalId,
      providerId: QUICKBOOKS_PROVIDER_ID,
      ...(answer ? { raw: answer as Record<string, unknown> } : {}),
    })
  } catch (error) {
    logger.warn('QuickBooks refused to remove an object', {
      ...context,
      error: errorMessage(error),
    })
    return err(new UnprocessableEntityError(errorMessage(error), context))
  }
}
