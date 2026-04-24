// apps/extension/src/iframe/trpc.ts

import { z } from 'zod'

/**
 * Hand-typed tRPC client for the extension iframe.
 *
 * Why not import the AppRouter? `apps/web` is tier-5 in the monorepo
 * dependency rules — packages/apps cannot import each other. Instead we
 * declare the inputs/outputs we need, validate responses with Zod, and
 * accept that the contract is enforced at runtime, not compile time.
 *
 * If a procedure shape changes upstream, the Zod parse will fail loudly.
 * See plan §4e for the full rationale.
 */

// ─── Endpoint base resolution ──────────────────────────────────
// Baked in at build time from `@auxx/config`'s `WEBAPP_URL`. Resolution
// order (matches every other app in the monorepo): APP_URL env var >
// DOMAIN env var + `app.` subdomain > `http://localhost:${WEB_PORT || 3000}`.
// See `apps/extension/vite.config.ts` for the `define` that injects it.
const BASE_URL = __AUXX_WEBAPP_URL__

// ─── Session probe ─────────────────────────────────────────────
//
// The iframe asks auxx.ai directly whether the current browser profile
// has a valid session, and — if yes — pulls the same `DehydratedState`
// the web app uses (Redis-backed cache, user + orgs + environment).
// Cookies ride via CORS (extension origin is in the allowlist; cookie
// is `SameSite=None; Secure` everywhere). If the probe fails or the
// server says no session, we render the sign-in CTA.
//
// We validate only the shape we actually read; everything else rides
// along via `.passthrough()` so the iframe can pull more off `state`
// later without touching this schema.

const DehydratedOrgSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    handle: z.string().nullable(),
  })
  .passthrough()
export type DehydratedOrg = z.infer<typeof DehydratedOrgSchema>

const DehydratedStateSchema = z
  .object({
    organizationId: z.string().nullable(),
    organizations: z.array(DehydratedOrgSchema),
    user: z.object({ id: z.string() }).passthrough().nullable().optional(),
  })
  .passthrough()
export type DehydratedState = z.infer<typeof DehydratedStateSchema>

const SessionResponse = z.discriminatedUnion('signedIn', [
  z.object({ signedIn: z.literal(true), state: DehydratedStateSchema }),
  z.object({ signedIn: z.literal(false) }),
])
export type SessionResponse = z.infer<typeof SessionResponse>

export async function fetchSession(): Promise<SessionResponse> {
  const url = new URL('/api/extension/session', BASE_URL).toString()
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) return { signedIn: false }
    const json = (await res.json().catch(() => null)) as unknown
    const parsed = SessionResponse.safeParse(json)
    return parsed.success ? parsed.data : { signedIn: false }
  } catch {
    // Network failure, DNS, offline — treat as signed-out for UX purposes.
    return { signedIn: false }
  }
}

/** Pull the active org (by `organizationId`) out of a signed-in state. */
export function activeOrg(state: DehydratedState): DehydratedOrg | null {
  if (!state.organizationId) return null
  return state.organizations.find((o) => o.id === state.organizationId) ?? null
}

// ─── Generic call wrapper ──────────────────────────────────────
type ProcedureType = 'query' | 'mutation'

type CallOptions<O> = {
  procedure: string
  type: ProcedureType
  input: unknown
  outputSchema: z.ZodType<O>
}

class TrpcCallError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly httpStatus?: number
  ) {
    super(message)
    this.name = 'TrpcCallError'
  }
}

async function call<O>(opts: CallOptions<O>): Promise<O> {
  const url = new URL(`/api/trpc/${opts.procedure}`, BASE_URL)
  const init: RequestInit = {
    method: opts.type === 'query' ? 'GET' : 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
  }

  if (opts.type === 'mutation') {
    init.body = JSON.stringify({ json: opts.input })
  } else {
    url.searchParams.set('input', JSON.stringify({ json: opts.input }))
  }

  const res = await fetch(url.toString(), init)
  const json = (await res.json().catch(() => null)) as
    | {
        result?: { data?: { json?: unknown } }
        error?: { message?: string; data?: { code?: string } }
      }
    | null
    | unknown[]

  // tRPC batch endpoints return arrays — we use the non-batch form, which
  // returns either { result: { data: { json: ... } } } or { error: ... }.
  if (Array.isArray(json)) {
    throw new TrpcCallError('Unexpected batch response shape', undefined, res.status)
  }

  if (!res.ok || !json) {
    const message =
      (json &&
        typeof json === 'object' &&
        'error' in json &&
        (json as { error?: { message?: string } }).error?.message) ||
      `HTTP ${res.status}`
    const code =
      (json &&
        typeof json === 'object' &&
        'error' in json &&
        (json as { error?: { data?: { code?: string } } }).error?.data?.code) ||
      undefined
    throw new TrpcCallError(message, code, res.status)
  }

  const data =
    json && typeof json === 'object' && 'result' in json
      ? (json as { result?: { data?: { json?: unknown } } }).result?.data?.json
      : undefined

  return opts.outputSchema.parse(data)
}

// ─── Schemas for the 5 endpoints we use ────────────────────────
//
// These mirror what apps/web exposes. They're intentionally permissive
// where the upstream payload contains fields we don't read in v1.

// `record.create` returns `{ instance, recordId, values }` (CreateEntityResult).
// We only need `instance.id` to deep-link the user into the new record.
const RecordCreateOutput = z
  .object({
    instance: z
      .object({
        id: z.string(),
      })
      .passthrough(),
    recordId: z.string(),
  })
  .passthrough()
type RecordCreateOutput = z.infer<typeof RecordCreateOutput>

// `record.search` returns a paginated picker result: `{ items, nextCursor, ... }`.
// Each item has a bare `id` (instance id) plus a composite `recordId`.
const RecordSearchOutput = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string(),
            recordId: z.string().optional(),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough()
type RecordSearchOutput = z.infer<typeof RecordSearchOutput>

const ParserHealthOutput = z.object({
  ok: z.literal(true),
})
type ParserHealthOutput = z.infer<typeof ParserHealthOutput>

// ─── Public API ────────────────────────────────────────────────

export type FieldValueMap = Record<string, unknown>

export type CreateRecordInput = {
  entityDefinitionId: 'contact' | 'company'
  /**
   * Map of field key → value. Backend route accepts this under `values`
   * (see `apps/web/src/server/api/routers/record.ts:createInputSchema`).
   */
  values: FieldValueMap
}

export async function createRecord(input: CreateRecordInput): Promise<RecordCreateOutput> {
  return call({
    procedure: 'record.create',
    type: 'mutation',
    input,
    outputSchema: RecordCreateOutput,
  })
}

export type SearchRecordInput = {
  entityDefinitionId: 'contact' | 'company'
  /** Free-text query. Used for best-effort dedup on externalId / email. */
  query: string
  limit?: number
}

export async function searchRecords(input: SearchRecordInput): Promise<RecordSearchOutput> {
  return call({
    procedure: 'record.search',
    type: 'query',
    input: { ...input, limit: input.limit ?? 5 },
    outputSchema: RecordSearchOutput,
  })
}

export function firstResultId(out: RecordSearchOutput): string | null {
  return out.items[0]?.id ?? null
}

export type ParserHealthInput = {
  host: string
  url: string
  parsed: boolean
  extensionVersion: string
}

export async function reportParserHealth(input: ParserHealthInput): Promise<ParserHealthOutput> {
  return call({
    procedure: 'extension.parserHealth',
    type: 'mutation',
    input,
    outputSchema: ParserHealthOutput,
  })
}

// `organization.setDefault` returns `{ success, organizationId }`. We only
// need it to resolve the mutation; the iframe re-reads /api/extension/session
// afterwards to pick up the refreshed dehydrated state.
const SetDefaultOrgOutput = z
  .object({
    success: z.boolean(),
    organizationId: z.string(),
  })
  .passthrough()
type SetDefaultOrgOutput = z.infer<typeof SetDefaultOrgOutput>

export async function setDefaultOrganization(organizationId: string): Promise<SetDefaultOrgOutput> {
  return call({
    procedure: 'organization.setDefault',
    type: 'mutation',
    input: { organizationId },
    outputSchema: SetDefaultOrgOutput,
  })
}

/** Sign out via Better-auth's REST endpoint — no dependency on better-auth/react. */
export async function signOut(): Promise<void> {
  await fetch(new URL('/api/auth/sign-out', BASE_URL).toString(), {
    method: 'POST',
    credentials: 'include',
  })
}

export { BASE_URL, TrpcCallError }
