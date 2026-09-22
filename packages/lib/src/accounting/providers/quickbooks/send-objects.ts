// packages/lib/src/accounting/providers/quickbooks/send-objects.ts
// Many native objects in two `batch_quickbooks_operations` calls: one query for the
// set's DocNumbers (layer 2), one create for the misses (plan 93 §5 D2/D3).

import { createHash } from 'node:crypto'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import type { ProviderObjectContext, SendObjectInput, SendObjectResult } from '../provider'
import type { QuickbooksToolContext } from './invoke-quickbooks-tool'
import {
  type AdoptedObject,
  matchByDocNumber,
  QUICKBOOKS_PROVIDER_ID,
  recoverOrClassify,
  requireToolInputs,
} from './objects/shared'

const logger = createScopedLogger('quickbooks-send-objects')

export const BATCH_TOOL = 'batch_quickbooks_operations'
/** Intuit's cap on `BatchItemRequest`s per call, and the tool's on `docNumbers` per query item. */
const MAX_BATCH_ITEMS = 30

/** What an object's `build` hands back: the create tool's input minus `requestId`, or an answer already reached. */
export type BuiltCreate = { create: Record<string, unknown> } | { settled: SendObjectResult }

/**
 * One native object as both the single `send` and the batch drive it: `build`
 * resolves accounts, customers and items (and may throw, which the caller classifies).
 */
export interface QuickbooksBatchObject<P = unknown> {
  /** The batch tool's `object` key. */
  object: string
  parse(payload: Record<string, unknown>): Result<P, Error>
  build(
    tool: QuickbooksToolContext,
    ctx: ProviderObjectContext,
    payload: P
  ): Promise<Result<BuiltCreate, Error>>
  answer(tool: QuickbooksToolContext, created: unknown): Result<SendObjectResult, Error>
  /** Null for Payment and Deposit: no DocNumber, so no layer 2 and no net. */
  find: { listField: string; idField: string; docNumber(payload: P): string } | null
}

interface BatchItemError {
  code: string
  message: string
  fault: { code: string | null } | null
}

interface BatchItemResult {
  bId: string
  ok: boolean
  result?: unknown
  error?: BatchItemError
}

/** A per-item error in the shape `classifyQuickbooksFailure` reads off a thrown single-tool error. */
function itemError(error: BatchItemError | undefined): Error {
  if (!error) return missingAnswer()
  return Object.assign(new Error(error.message), { code: error.code, quickbooksFault: error.fault })
}

/** No answer for an item is an unknown outcome: transport, so the net re-queries before anything retries. */
function missingAnswer(): Error {
  return Object.assign(new Error('QuickBooks returned no answer for this batch item.'), {
    code: 'UPSTREAM_ERROR',
    quickbooksFault: null,
  })
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * One `bId` per idempotency key, aligned with `keys`: ≤ 10 chars (Intuit's cap when a
 * `requestid` is set) and unique within the call. Keys are walked sorted so a collision's
 * rehash lands the same way on every retry of the same set.
 */
export function batchItemIds(keys: readonly string[]): string[] {
  const ids: string[] = new Array(keys.length)
  const used = new Set<string>()
  const order = keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => a.key.localeCompare(b.key))
  for (const { key, index } of order) {
    let id = sha(key).slice(0, 10)
    for (let salt = 1; used.has(id); salt++) id = sha(`${key}#${salt}`).slice(0, 10)
    used.add(id)
    ids[index] = id
  }
  return ids
}

/** Intuit dedupes a batch item only on `requestid` + `bId`, so the call's id hashes the set's per-batch keys - the same keys the single path sends. */
export function batchRequestId(keys: readonly string[]): string {
  return sha([...keys].sort().join('\n')).slice(0, 36)
}

type Lookup = { ok: true; answer: unknown } | { ok: false; error: Error }

const lookupKey = (object: string, docNumber: string) => `${object}\u0000${docNumber}`

/** Batch `query` items for every (object, docNumber) wanted. Throws when a whole call fails. */
async function queryDocNumbers(
  tool: QuickbooksToolContext,
  wanted: ReadonlyArray<{ object: string; docNumber: string }>
): Promise<Map<string, Lookup>> {
  const byObject = new Map<string, Set<string>>()
  for (const { object, docNumber } of wanted) {
    const set = byObject.get(object) ?? new Set<string>()
    set.add(docNumber)
    byObject.set(object, set)
  }
  const items: Array<{ bId: string; operation: 'query'; object: string; docNumbers: string[] }> = []
  for (const [object, docNumbers] of byObject) {
    const all = [...docNumbers]
    for (let i = 0; i < all.length; i += MAX_BATCH_ITEMS)
      items.push({
        bId: `q${items.length}`,
        operation: 'query',
        object,
        docNumbers: all.slice(i, i + MAX_BATCH_ITEMS),
      })
  }

  const lookups = new Map<string, Lookup>()
  for (let i = 0; i < items.length; i += MAX_BATCH_ITEMS) {
    const chunk = items.slice(i, i + MAX_BATCH_ITEMS)
    const out = (await tool.callTool(BATCH_TOOL, { items: chunk })) as
      | { items?: BatchItemResult[] }
      | undefined
    const answered = new Map((out?.items ?? []).map((item) => [item.bId, item]))
    for (const item of chunk) {
      const answer = answered.get(item.bId)
      for (const docNumber of item.docNumbers) {
        const key = lookupKey(item.object, docNumber)
        if (!answer?.ok) {
          lookups.set(key, { ok: false, error: itemError(answer?.error) })
          continue
        }
        const byDoc = (answer.result ?? {}) as Record<string, unknown>
        lookups.set(
          key,
          docNumber in byDoc
            ? { ok: true, answer: byDoc[docNumber] }
            : { ok: false, error: missingAnswer() }
        )
      }
    }
  }
  return lookups
}

interface Pending {
  index: number
  spec: QuickbooksBatchObject
  docNumber: string | null
  create: Record<string, unknown>
  key: string
}

/**
 * Send many objects over one tool context, results aligned with `inputs`.
 *
 * Rows the batch tool cannot take (`vendor_credit`, or an installed app without the
 * tool) go through `single` on the same memoised context. Every per-row verdict is
 * the one the single `send` would reach: the same parse, build, adopt and classifier.
 */
export async function sendQuickbooksObjects(
  tool: QuickbooksToolContext,
  ctx: ProviderObjectContext,
  inputs: readonly SendObjectInput[],
  objects: Readonly<Record<string, QuickbooksBatchObject>>,
  single: (
    tool: QuickbooksToolContext,
    input: SendObjectInput
  ) => Promise<Result<SendObjectResult, Error>>
): Promise<Result<SendObjectResult, Error>[]> {
  const organizationId = ctx.organizationId
  const shared: QuickbooksToolContext = { ...tool, memo: tool.memo ?? new Map() }
  const batchReady = requireToolInputs(shared, BATCH_TOOL, ['items']) === null
  const results: Result<SendObjectResult, Error>[] = new Array(inputs.length)
  const tenant = shared.realmId ? { tenantId: shared.realmId } : {}

  const adoptedFrom = (lookup: Lookup | undefined, spec: QuickbooksBatchObject) => {
    if (!lookup) return undefined
    if (!lookup.ok) throw lookup.error
    return spec.find
      ? matchByDocNumber(lookup.answer, spec.find.listField, spec.find.idField)
      : undefined
  }
  const adoptOne = async (
    spec: QuickbooksBatchObject,
    docNumber: string
  ): Promise<AdoptedObject | undefined> => {
    const found = adoptedFrom(
      (await queryDocNumbers(shared, [{ object: spec.object, docNumber }])).get(
        lookupKey(spec.object, docNumber)
      ),
      spec
    )
    return found
      ? { externalId: found.externalId, remoteVersion: found.syncToken, ...tenant }
      : undefined
  }

  const pending: Pending[] = []
  for (const [index, input] of inputs.entries()) {
    const spec = batchReady ? objects[input.objectType] : undefined
    if (!spec) {
      results[index] = await single(shared, input)
      continue
    }
    const parsed = spec.parse(input.payload)
    if (parsed.isErr()) {
      results[index] = err(parsed.error)
      continue
    }
    const docNumber = spec.find ? spec.find.docNumber(parsed.value) : null
    try {
      const built = await spec.build(shared, ctx, parsed.value)
      if (built.isErr()) results[index] = err(built.error)
      else if ('settled' in built.value) results[index] = ok(built.value.settled)
      else
        pending.push({
          index,
          spec,
          docNumber,
          create: built.value.create,
          key: input.idempotencyKey,
        })
    } catch (error) {
      results[index] = await recoverOrClassify(
        organizationId,
        QUICKBOOKS_PROVIDER_ID,
        error,
        docNumber ? () => adoptOne(spec, docNumber) : null,
        { docNumber }
      )
    }
  }

  // Layer 2, for the whole set at once.
  const queryable = pending.filter((row) => row.docNumber !== null)
  const toCreate: Pending[] = pending.filter((row) => row.docNumber === null)
  if (queryable.length > 0) {
    let lookups: Map<string, Lookup> | undefined
    let failure: unknown
    try {
      lookups = await queryDocNumbers(
        shared,
        queryable.map((row) => ({ object: row.spec.object, docNumber: row.docNumber as string }))
      )
    } catch (error) {
      failure = error
    }
    for (const row of queryable) {
      const docNumber = row.docNumber as string
      const lookup = lookups?.get(lookupKey(row.spec.object, docNumber))
      if (!lookup || !lookup.ok) {
        results[row.index] = await recoverOrClassify(
          organizationId,
          QUICKBOOKS_PROVIDER_ID,
          lookup && !lookup.ok ? lookup.error : (failure ?? missingAnswer()),
          null,
          { docNumber }
        )
        continue
      }
      const existing = adoptedFrom(lookup, row.spec)
      if (!existing) {
        toCreate.push(row)
        continue
      }
      logger.warn('QuickBooks already holds this DocNumber - adopting, not re-posting', {
        organizationId,
        docNumber,
      })
      results[row.index] = ok({
        status: 'already_exists',
        externalId: existing.externalId,
        remoteVersion: existing.syncToken,
        providerId: QUICKBOOKS_PROVIDER_ID,
        ...tenant,
        echo: existing.echo,
      })
    }
  }

  const failed: Array<{ row: Pending; failure: unknown }> = []
  toCreate.sort((a, b) => a.index - b.index)
  for (let i = 0; i < toCreate.length; i += MAX_BATCH_ITEMS) {
    const chunk = toCreate.slice(i, i + MAX_BATCH_ITEMS)
    const keys = chunk.map((row) => row.key)
    const bIds = batchItemIds(keys)
    try {
      const out = (await shared.callTool(BATCH_TOOL, {
        requestId: batchRequestId(keys),
        items: chunk.map((row, at) => ({
          bId: bIds[at],
          operation: 'create',
          object: row.spec.object,
          input: row.create,
        })),
      })) as { items?: BatchItemResult[] } | undefined
      const answered = new Map((out?.items ?? []).map((item) => [item.bId, item]))
      for (const [at, row] of chunk.entries()) {
        const item = answered.get(bIds[at] as string)
        if (item?.ok) results[row.index] = row.spec.answer(shared, item.result)
        else failed.push({ row, failure: itemError(item?.error) })
      }
    } catch (error) {
      for (const row of chunk) failed.push({ row, failure: error })
    }
  }

  // The net under the creates: one query for every failed row that has a DocNumber.
  let net: Promise<Map<string, Lookup>> | undefined
  const netLookup = () => {
    net ??= queryDocNumbers(
      shared,
      failed
        .filter(({ row }) => row.docNumber !== null)
        .map(({ row }) => ({ object: row.spec.object, docNumber: row.docNumber as string }))
    )
    return net
  }
  for (const { row, failure } of failed) {
    const docNumber = row.docNumber
    results[row.index] = await recoverOrClassify(
      organizationId,
      QUICKBOOKS_PROVIDER_ID,
      failure,
      docNumber
        ? async () => {
            const found = adoptedFrom(
              (await netLookup()).get(lookupKey(row.spec.object, docNumber)),
              row.spec
            )
            return found
              ? { externalId: found.externalId, remoteVersion: found.syncToken, ...tenant }
              : undefined
          }
        : null,
      { docNumber }
    )
  }

  logger.info('QuickBooks batch send finished', {
    organizationId,
    objects: inputs.length,
    attempted: toCreate.length,
    failed: failed.length,
  })
  return results
}
