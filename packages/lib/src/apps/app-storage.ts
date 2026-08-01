// packages/lib/src/apps/app-storage.ts

/**
 * Functional queries for the app KV store (`AppStorage`). Backs the
 * `@auxx/sdk/server` `storage` surface via the `apps/api` SDK routes.
 *
 * Every function takes the resolved scope tuple
 * `(appInstallationId, connectionId | null, collection, ...)` — `connectionId`
 * null is installation scope, set is connection scope; `collection` '' is the
 * plain top-level namespace, a named collection is an enumerable bucket.
 *
 * Validation (key/collection shape, value size, namespace cap) lives here so
 * both the routes and any direct lib caller get the same guards. Results use
 * neverthrow, matching the sibling `apps/` modules.
 */

import { AppStorage, database } from '@auxx/database'
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError } from '../errors'

/** Valid storage key: alphanumerics + `:._-`, 1–255 chars. */
const KEY_RE = /^[a-zA-Z0-9:._-]{1,255}$/
/** Valid collection name (the '' plain namespace is internal, never user input). */
const COLLECTION_RE = /^[a-zA-Z0-9._-]{1,64}$/
/** Serialized value cap. Beyond this, callers should store a reference, not the blob. */
const MAX_VALUE_BYTES = 256 * 1024
/** Runaway-loop guardrail per `(appInstallationId, connectionId)`. Not an exact quota. */
const NAMESPACE_CAP = 5000
/** List page size defaults + clamp. The namespace cap keeps every collection on one page. */
const DEFAULT_LIST_LIMIT = 1000
const MAX_LIST_LIMIT = 5000

/** A read result: `{ value }` when present (a stored `null` included), `null` when absent/expired. */
export interface AppStorageItem {
  value: unknown
}

/** One enumerated collection entry. */
export interface AppStorageEntry {
  key: string
  value: unknown
}

function validateKey(key: string): Result<true, Error> {
  if (!KEY_RE.test(key)) {
    return err(new BadRequestError(`Invalid storage key: must match ${KEY_RE.source}`))
  }
  return ok(true)
}

/** Collection must match the public regex; '' (plain namespace) is allowed internally only. */
function validateCollection(collection: string): Result<true, Error> {
  if (collection === '') return ok(true)
  if (!COLLECTION_RE.test(collection)) {
    return err(new BadRequestError(`Invalid collection name: must match ${COLLECTION_RE.source}`))
  }
  return ok(true)
}

function validateValueSize(value: unknown): Result<true, Error> {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    return err(new BadRequestError('Storage value must be JSON-serializable'))
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_VALUE_BYTES) {
    return err(new BadRequestError(`Storage value exceeds ${MAX_VALUE_BYTES} bytes`))
  }
  return ok(true)
}

/** Scope predicate — handles the NULL connectionId (installation scope) branch. */
function scopeWhere(appInstallationId: string, connectionId: string | null, collection: string) {
  return and(
    eq(AppStorage.appInstallationId, appInstallationId),
    connectionId === null
      ? isNull(AppStorage.connectionId)
      : eq(AppStorage.connectionId, connectionId),
    eq(AppStorage.collection, collection)
  )
}

/**
 * Reject a brand-new key once the namespace is at the cap. Updates to an
 * existing key are always allowed (they don't grow the namespace). The
 * count-then-insert window is racy by design — it's a guardrail, not a quota.
 */
async function ensureNamespaceCapacity(
  appInstallationId: string,
  connectionId: string | null,
  collection: string,
  key: string
): Promise<Result<true, Error>> {
  const [totals] = await database
    .select({ total: count() })
    .from(AppStorage)
    .where(
      and(
        eq(AppStorage.appInstallationId, appInstallationId),
        connectionId === null
          ? isNull(AppStorage.connectionId)
          : eq(AppStorage.connectionId, connectionId)
      )
    )
  if ((totals?.total ?? 0) < NAMESPACE_CAP) return ok(true)

  const existing = await database
    .select({ id: AppStorage.id })
    .from(AppStorage)
    .where(and(scopeWhere(appInstallationId, connectionId, collection), eq(AppStorage.key, key)))
    .limit(1)
  if (existing.length > 0) return ok(true)

  return err(
    new BadRequestError(`Storage namespace full (max ${NAMESPACE_CAP} keys per connection)`)
  )
}

/**
 * Read a value. Returns `{ value }` when present, `null` when the key is
 * missing or its row has expired (lazy expiry — the sweep deletes it later).
 */
export async function getAppStorageValue(
  appInstallationId: string,
  connectionId: string | null,
  collection: string,
  key: string
): Promise<Result<AppStorageItem | null, Error>> {
  const valid = validateKey(key).andThen(() => validateCollection(collection))
  if (valid.isErr()) return err(valid.error)

  const rows = await database
    .select({ value: AppStorage.value, expiresAt: AppStorage.expiresAt })
    .from(AppStorage)
    .where(and(scopeWhere(appInstallationId, connectionId, collection), eq(AppStorage.key, key)))
    .limit(1)

  const row = rows[0]
  if (!row) return ok(null)
  if (row.expiresAt && row.expiresAt <= new Date()) return ok(null)
  return ok({ value: row.value })
}

/** Upsert a value (with optional absolute expiry). Overwrites any existing row. */
export async function setAppStorageValue(
  appInstallationId: string,
  connectionId: string | null,
  collection: string,
  key: string,
  value: unknown,
  expiresAt: Date | null
): Promise<Result<void, Error>> {
  const valid = validateKey(key)
    .andThen(() => validateCollection(collection))
    .andThen(() => validateValueSize(value))
  if (valid.isErr()) return err(valid.error)

  const capacity = await ensureNamespaceCapacity(appInstallationId, connectionId, collection, key)
  if (capacity.isErr()) return err(capacity.error)

  await database
    .insert(AppStorage)
    .values({ appInstallationId, connectionId, collection, key, value, expiresAt })
    .onConflictDoUpdate({
      target: [
        AppStorage.appInstallationId,
        AppStorage.connectionId,
        AppStorage.collection,
        AppStorage.key,
      ],
      set: { value, expiresAt, updatedAt: new Date() },
    })

  return ok(undefined)
}

/**
 * Atomic insert-if-missing. Returns `true` when this call created (or claimed an
 * expired) row, `false` when a live key already held the slot. The idempotency
 * primitive — `onConflictDoUpdate` gated to expired rows + RETURNING.
 */
export async function setAppStorageValueIfAbsent(
  appInstallationId: string,
  connectionId: string | null,
  collection: string,
  key: string,
  value: unknown,
  expiresAt: Date | null
): Promise<Result<boolean, Error>> {
  const valid = validateKey(key)
    .andThen(() => validateCollection(collection))
    .andThen(() => validateValueSize(value))
  if (valid.isErr()) return err(valid.error)

  const capacity = await ensureNamespaceCapacity(appInstallationId, connectionId, collection, key)
  if (capacity.isErr()) return err(capacity.error)

  const now = new Date()
  const claimed = await database
    .insert(AppStorage)
    .values({ appInstallationId, connectionId, collection, key, value, expiresAt })
    .onConflictDoUpdate({
      target: [
        AppStorage.appInstallationId,
        AppStorage.connectionId,
        AppStorage.collection,
        AppStorage.key,
      ],
      // Only take over a conflicting row when it has already expired. A live
      // row matches no setWhere → no update → empty RETURNING → claim fails.
      set: { value, expiresAt, createdAt: now, updatedAt: now },
      setWhere: and(isNotNull(AppStorage.expiresAt), lte(AppStorage.expiresAt, now)),
    })
    .returning({ id: AppStorage.id })

  return ok(claimed.length > 0)
}

/** Idempotent delete — no error when the key is absent. */
export async function deleteAppStorageValue(
  appInstallationId: string,
  connectionId: string | null,
  collection: string,
  key: string
): Promise<Result<void, Error>> {
  const valid = validateKey(key).andThen(() => validateCollection(collection))
  if (valid.isErr()) return err(valid.error)

  await database
    .delete(AppStorage)
    .where(and(scopeWhere(appInstallationId, connectionId, collection), eq(AppStorage.key, key)))

  return ok(undefined)
}

/**
 * Enumerate one collection (exact-match, single page). Skips expired rows,
 * orders by key asc. `limit` defaults to 1,000, clamped to 5,000 — the
 * namespace cap guarantees a collection always fits in one page.
 */
export async function listAppStorageValues(
  appInstallationId: string,
  connectionId: string | null,
  collection: string,
  limit?: number
): Promise<Result<AppStorageEntry[], Error>> {
  const valid = validateCollection(collection)
  if (valid.isErr()) return err(valid.error)

  const clamped = Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_LIST_LIMIT)), MAX_LIST_LIMIT)
  const now = new Date()

  const rows = await database
    .select({ key: AppStorage.key, value: AppStorage.value })
    .from(AppStorage)
    .where(
      and(
        scopeWhere(appInstallationId, connectionId, collection),
        or(isNull(AppStorage.expiresAt), gt(AppStorage.expiresAt, now))
      )
    )
    .orderBy(asc(AppStorage.key))
    .limit(clamped)

  return ok(rows.map((r) => ({ key: r.key, value: r.value })))
}

/** Count expired rows across the whole table — used by the sweep job's dry run. */
export async function countExpiredAppStorage(): Promise<Result<number, Error>> {
  const [row] = await database
    .select({ total: count() })
    .from(AppStorage)
    .where(and(isNotNull(AppStorage.expiresAt), lte(AppStorage.expiresAt, new Date())))
  return ok(row?.total ?? 0)
}

/**
 * Sweep helper: delete up to `batchSize` expired rows. Returns the count
 * deleted (a batch smaller than `batchSize` means the table is drained).
 */
export async function deleteExpiredAppStorage(batchSize: number): Promise<Result<number, Error>> {
  const now = new Date()
  const stale = await database
    .select({ id: AppStorage.id })
    .from(AppStorage)
    .where(and(isNotNull(AppStorage.expiresAt), lte(AppStorage.expiresAt, now)))
    .limit(batchSize)

  if (stale.length === 0) return ok(0)

  await database.delete(AppStorage).where(
    inArray(
      AppStorage.id,
      stale.map((r) => r.id)
    )
  )

  return ok(stale.length)
}
