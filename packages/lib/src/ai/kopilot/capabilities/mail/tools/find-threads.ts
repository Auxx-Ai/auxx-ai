// packages/lib/src/ai/kopilot/capabilities/mail/tools/find-threads.ts

import type { ParticipantId } from '@auxx/types'
import { safeParseActorId } from '@auxx/types/actor'
import { getInstanceId, isRecordId, parseRecordId, type RecordId } from '@auxx/types/resource'
import { z } from 'zod'
import { getCachedMembers, getCachedUserInstanceGrants, getOrgCache } from '../../../../../cache'
import type { Condition, ConditionGroup } from '../../../../../conditions'
import type { Inbox } from '../../../../../inboxes/types'
import { buildConditionGroupsQueryWithDiagnostics } from '../../../../../mail-query/condition-query-builder'
import { ParticipantService } from '../../../../../participants'
import type { UserInstanceGrants } from '../../../../../permissions/visibility/context'
import { inboxLensFor } from '../../../../../permissions/visibility/effective-lens'
import { TagService } from '../../../../../tags'
import { ThreadQueryService } from '../../../../../threads'
import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

const MAX_RESULTS = 25

/**
 * Arguments that actually narrow the result set. At least one is required —
 * `find_threads` refuses to answer an unfiltered "list threads" question rather
 * than inventing a filter of its own (retrieval plan step 1.2, level 2).
 */
const FILTER_ARGS = [
  'status',
  'assigneeId',
  'query',
  'sender',
  'tagIds',
  'inboxId',
  'after',
  'before',
  'sharedWithMe',
] as const

/** Arguments that shape the result set but do not filter it. */
const CONTROL_ARGS = ['limit', 'sortBy', 'sortDirection'] as const

const SUPPORTED_ARGS = new Set<string>([...FILTER_ARGS, ...CONTROL_ARGS])

/**
 * Argument names the engine injects into *every* tool call from the session's
 * active references (`kopilot/context-refs.ts` `ARG_TO_REF_KIND`), before
 * `validateInputs` runs (`agent-framework/query-loop.ts:1282` → `:1343`).
 * They are not model-authored, so they are dropped silently instead of being
 * reported as unsupported arguments.
 *
 * **Keep this in sync with `ARG_TO_REF_KIND`.** A new ref binding that is not
 * listed here makes every `find_threads` call on a page carrying that ref fail
 * as "unsupported argument"; a filter argument that collides with a ref name
 * would be overwritten by the injector before the model's value is read.
 */
const CONTEXT_INJECTED_ARGS = new Set(['threadId', 'articleId', 'knowledgeBaseId', 'actorId'])

const SORT_BY_VALUES = ['lastMessageAt', 'subject'] as const
const SORT_DIRECTION_VALUES = ['asc', 'desc'] as const
const STATUS_VALUES = ['OPEN', 'ARCHIVED', 'SPAM', 'TRASH', 'IGNORED'] as const

/**
 * Statuses excluded when the caller names no `status`.
 *
 * Not an invented filter: it is the same default the mail UI applies to every
 * context that isn't the trash/spam folder itself
 * (`mail-query/context-to-conditions.ts` — `ctx-status-exclude`). "The mailbox"
 * means the same thing to the model as it does to the user looking at it, and
 * the tool description says so. Pass `status` explicitly to reach them.
 */
const DEFAULT_EXCLUDED_STATUSES = ['TRASH', 'SPAM', 'IGNORED'] as const

/** How many valid values an "id did not resolve" error is allowed to list. */
const MAX_LISTED_VALUES = 25

/**
 * Which tool argument produced a given condition, for error text.
 *
 * Conditions are built with a deterministic `arg:<name>` id so a drop reported
 * by the query builder maps back to the argument the model wrote, even where
 * two arguments share one `fieldId` (`after` / `before` are both `date`).
 */
const ARG_BY_FIELD_ID: Record<string, string> = {
  status: 'status',
  assignee: 'assigneeId',
  freeText: 'query',
  sender: 'sender',
  tag: 'tagIds',
  inbox: 'inboxId',
  date: 'after/before',
  sharedWithMe: 'sharedWithMe',
}

/** Recover the argument name from a condition id minted by {@link buildThreadConditions}. */
function argNameFor(conditionId: string, fieldId: string): string {
  if (conditionId.startsWith('arg:')) return conditionId.slice('arg:'.length)
  return ARG_BY_FIELD_ID[fieldId] ?? fieldId
}

const SUPPORTED_ARGS_SENTENCE = `Supported filters: ${FILTER_ARGS.join(', ')}. Supported result controls: ${CONTROL_ARGS.join(', ')}.`

/** Full success output of `find_threads` — matching thread summaries with resolved tags. */
const FindThreadsOutput = z.object({
  /**
   * Present only on a zero-result run: what to try next, so an empty list is
   * not read as "there are none" (ported from `search_entities`).
   */
  suggestion: z.string().optional(),
  threads: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      status: z.string(),
      assigneeId: z.string().nullable(),
      /**
       * Who sent the MOST RECENT message — the same identity the mail list row
       * shows, so an outbound reply reports the agent/user who sent it, not the
       * customer. Null when the latest message has no `from` participant.
       *
       * Participants are metadata-tier (`threads/types.ts` — visible at every
       * lens), so this is safe to return for a thread whose bodies the viewer
       * cannot read.
       */
      sender: z.object({ name: z.string().nullable(), identifier: z.string() }).nullable(),
      lastMessageAt: z.string(),
      messageCount: z.number(),
      isUnread: z.boolean(),
      tagIds: z.array(z.string()),
      tags: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          color: z.string(),
          emoji: z.string().nullable(),
        })
      ),
    })
  ),
  count: z.number(),
})

/**
 * Build ConditionGroups from flat search args.
 * Maps user-friendly args to the condition format ThreadQueryService expects.
 *
 * Returns an empty array when no filter argument was supplied — the caller
 * turns that into an error. This function never invents a filter; the only
 * condition it adds on its own is the UI's own trash/spam/ignored exclusion
 * ({@link DEFAULT_EXCLUDED_STATUSES}), and only when `status` is absent.
 *
 * Condition ids are `arg:<name>` so a dropped condition can be reported against
 * the argument the model actually wrote.
 *
 * Exported for tests: it is the whole argument→condition mapping, and the date
 * arm cannot be exercised through `execute` under vitest (drizzle columns are
 * undefined there, so `buildDateQuery` declines before the mapping is visible).
 */
export function buildThreadConditions(args: Record<string, unknown>): ConditionGroup[] {
  const conditions: Condition[] = []

  if (args.status) {
    conditions.push({
      id: 'arg:status',
      fieldId: 'status',
      operator: 'is',
      value: (args.status as string).toLowerCase(),
    })
  }

  if (args.assigneeId) {
    conditions.push({
      id: 'arg:assigneeId',
      fieldId: 'assignee',
      operator: 'is',
      value: args.assigneeId as string,
    })
  }

  if (args.query) {
    conditions.push({
      id: 'arg:query',
      fieldId: 'freeText',
      operator: 'contains',
      value: args.query as string,
    })
  }

  if (args.sender) {
    conditions.push({
      id: 'arg:sender',
      fieldId: 'sender',
      operator: 'contains',
      value: args.sender as string,
    })
  }

  if (args.tagIds && Array.isArray(args.tagIds) && args.tagIds.length > 0) {
    conditions.push({
      id: 'arg:tagIds',
      fieldId: 'tag',
      operator: 'in',
      value: args.tagIds as string[],
    })
  }

  if (args.inboxId) {
    conditions.push({
      id: 'arg:inboxId',
      fieldId: 'inbox',
      operator: 'is',
      value: args.inboxId as string,
    })
  }

  // `metadata.field` names the Thread column: activity, not creation.
  if (args.after) {
    conditions.push({
      id: 'arg:after',
      fieldId: 'date',
      operator: 'after',
      value: args.after as string,
      metadata: { field: 'lastMessageAt' },
    })
  }

  if (args.before) {
    conditions.push({
      id: 'arg:before',
      fieldId: 'date',
      operator: 'before',
      value: args.before as string,
      metadata: { field: 'lastMessageAt' },
    })
  }

  if (args.sharedWithMe === true) {
    conditions.push({
      id: 'arg:sharedWithMe',
      fieldId: 'sharedWithMe',
      operator: 'is',
      value: true,
    })
  }

  // No `status = 'open'` fallback. An unfiltered call is a different question
  // from the one that was asked, and answering it reads as a wrong answer.
  if (conditions.length === 0) return []

  // Mirror the mail UI: unless a status was named, trash/spam/ignored are not
  // part of "the mailbox". Without this, "threads assigned to me" answers with
  // deleted and junk threads, which no user means by the question.
  if (!args.status) {
    conditions.push({
      id: 'default:status-exclude',
      fieldId: 'status',
      operator: 'not in',
      value: [...DEFAULT_EXCLUDED_STATUSES],
    })
  }

  return [
    {
      id: 'find-threads',
      conditions,
      logicalOperator: 'AND',
    },
  ]
}

/**
 * Parse a `YYYY-MM-DD` (or full ISO 8601) date argument into an ISO instant.
 *
 * The prompt's `now` section states today's date **as the calendar date in the
 * rendered timezone** (currently always UTC — per-user zones are a known
 * follow-up), and tells the model to pass `YYYY-MM-DD` computed from it. So a
 * bare date is anchored at midnight in that same zone; anything else would put
 * the tool's day boundary somewhere other than the one the model was shown.
 */
function parseDateArg(
  name: string,
  raw: unknown
): { ok: true; value?: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true }
  if (typeof raw !== 'string') {
    return { ok: false, error: `${name} must be a date string (YYYY-MM-DD); got ${typeof raw}.` }
  }

  const text = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00.000Z`)
    // Rejects 2026-02-31 and friends, which `Date` would silently roll over.
    if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(text)) {
      return { ok: false, error: `${name} is not a real date: '${raw}'. Use YYYY-MM-DD.` }
    }
    return { ok: true, value: parsed.toISOString() }
  }

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      error: `${name} must be a date in YYYY-MM-DD form (UTC), computed from today's date in the prompt; got '${raw}'.`,
    }
  }
  return { ok: true, value: parsed.toISOString() }
}

/**
 * Reject arguments this tool does not map, and normalize the ones it does.
 *
 * The tool's `additionalProperties: false` is documentation only — schema
 * validation is opt-in per tool in this framework, so without this validator an
 * argument this tool does not map (`hasAttachments`, `ticketId`, `isUnread`, …)
 * is silently discarded and the tool answers a wider question than it was asked.
 *
 * Value-level checks live here; the id-shaped arguments (`inboxId`,
 * `assigneeId`) are *resolved* in `execute`, which is the layer that can reach
 * the org cache.
 */
function validateFindThreadsArgs(
  args: Record<string, unknown>
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const unsupported = Object.keys(args).filter(
    (key) =>
      args[key] !== undefined &&
      args[key] !== null &&
      !SUPPORTED_ARGS.has(key) &&
      !CONTEXT_INJECTED_ARGS.has(key)
  )
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: `find_threads does not support: ${unsupported.join(', ')}. ${SUPPORTED_ARGS_SENTENCE} Drop the unsupported argument and retry, or tell the user this filter is not available — do not re-run without it and present the result as an answer to the original question.`,
    }
  }

  const normalized: Record<string, unknown> = {}
  for (const key of [...FILTER_ARGS, ...CONTROL_ARGS]) {
    if (args[key] !== undefined && args[key] !== null) normalized[key] = args[key]
  }

  for (const key of ['status', 'assigneeId', 'query', 'sender', 'inboxId'] as const) {
    const parsed = parseStringArg(normalized[key], { name: key, max: 500 })
    if (!parsed.ok) return { ok: false, error: parsed.error }
    if (parsed.value === undefined) delete normalized[key]
    else normalized[key] = parsed.value
  }

  if (normalized.status !== undefined) {
    const status = String(normalized.status).toUpperCase()
    if (!STATUS_VALUES.includes(status as never)) {
      return {
        ok: false,
        error: `status must be one of: ${STATUS_VALUES.join(', ')}; got '${String(args.status)}'.`,
      }
    }
    normalized.status = status
  }

  for (const key of ['after', 'before'] as const) {
    const parsed = parseDateArg(key, normalized[key])
    if (!parsed.ok) return { ok: false, error: parsed.error }
    if (parsed.value === undefined) delete normalized[key]
    else normalized[key] = parsed.value
  }

  const after = normalized.after as string | undefined
  const before = normalized.before as string | undefined
  if (after && before && after >= before) {
    return {
      ok: false,
      error: `after (${after}) is not earlier than before (${before}), so no thread can match. Swap them or drop one.`,
    }
  }

  if (normalized.sharedWithMe !== undefined) {
    const raw = normalized.sharedWithMe
    const shared = raw === true || raw === 'true'
    if (!shared) {
      return {
        ok: false,
        error: `sharedWithMe only takes true (threads explicitly shared with you). To search everything you can see, omit it; got '${String(args.sharedWithMe)}'.`,
      }
    }
    normalized.sharedWithMe = true
  }

  const rawTagIds: unknown = normalized.tagIds
  if (rawTagIds !== undefined) {
    if (!Array.isArray(rawTagIds)) {
      return { ok: false, error: `tagIds must be an array of tag ids; got ${typeof rawTagIds}.` }
    }
    const tagIds = rawTagIds.filter((t): t is string => typeof t === 'string' && t !== '')
    if (tagIds.length !== rawTagIds.length) {
      return { ok: false, error: 'tagIds must contain only non-empty strings.' }
    }
    if (tagIds.length === 0) delete normalized.tagIds
    else normalized.tagIds = tagIds
  }

  if (normalized.limit !== undefined) {
    const limit = Number(normalized.limit)
    if (!Number.isFinite(limit) || limit < 1) {
      return { ok: false, error: `limit must be a positive number; got ${String(args.limit)}.` }
    }
    normalized.limit = Math.min(Math.floor(limit), MAX_RESULTS)
  }

  if (normalized.sortBy !== undefined && !SORT_BY_VALUES.includes(normalized.sortBy as never)) {
    return {
      ok: false,
      error: `sortBy must be one of: ${SORT_BY_VALUES.join(', ')}; got '${String(args.sortBy)}'.`,
    }
  }
  if (
    normalized.sortDirection !== undefined &&
    !SORT_DIRECTION_VALUES.includes(normalized.sortDirection as never)
  ) {
    return {
      ok: false,
      error: `sortDirection must be one of: ${SORT_DIRECTION_VALUES.join(', ')}; got '${String(args.sortDirection)}'.`,
    }
  }

  const hasFilter = FILTER_ARGS.some((key) => normalized[key] !== undefined)
  if (!hasFilter) {
    return {
      ok: false,
      error: `find_threads needs at least one filter — it does not list the whole mailbox. ${SUPPORTED_ARGS_SENTENCE} If the question cannot be expressed with those, say so instead of running an unfiltered search.`,
    }
  }

  return { ok: true, args: normalized }
}

/**
 * Split a role-prefixed `ParticipantId` (`from:abc`) without throwing.
 *
 * `parseParticipantId` throws on an unknown role, and a thread row is not worth
 * failing a whole search over — an unparseable participant just yields no
 * sender for that thread.
 */
function splitParticipantId(value: ParticipantId): { role: string; id: string } | null {
  const colon = value.indexOf(':')
  if (colon <= 0) return null
  const id = value.slice(colon + 1)
  return id ? { role: value.slice(0, colon), id } : null
}

/** Format a bounded "valid values" list for an error message. */
function listValues(values: string[]): string {
  const shown = values.slice(0, MAX_LISTED_VALUES)
  const rest = values.length - shown.length
  if (shown.length === 0) return 'none'
  return rest > 0 ? `${shown.join(', ')}, …and ${rest} more` : shown.join(', ')
}

/**
 * Resolve an `inboxId` argument to a raw inbox id the query layer can use.
 *
 * Accepts a raw id or an `inbox:<id>` / `personal_inbox:<id>` RecordId (the
 * query builder strips the prefix either way). An id that names no inbox the
 * viewer can see is an error listing the ones they can — silently returning
 * zero threads reads as "there are none".
 *
 * The candidate list is filtered through the viewer's own inbox lens, so the
 * error can never disclose a mailbox they aren't allowed to know exists.
 */
async function resolveInboxId(
  organizationId: string,
  viewer: UserInstanceGrants,
  raw: string
): Promise<{ ok: true; inboxId: string } | { ok: false; error: string }> {
  const wanted = isRecordId(raw) ? getInstanceId(raw as RecordId) : raw
  const inboxes: Inbox[] = await getOrgCache().get(organizationId, 'inboxes')
  const visible = inboxes.filter((inbox) => inboxLensFor(viewer, inbox.id) !== 'none')

  const match = visible.find((inbox) => inbox.id === wanted || inbox.recordId === raw)
  if (match) return { ok: true, inboxId: match.id }

  return {
    ok: false,
    error: `inboxId '${raw}' does not match an inbox you can see. Valid inboxes: ${listValues(
      visible.map((inbox) => `${inbox.name} (${inbox.id})`)
    )}.`,
  }
}

/**
 * Resolve an `assigneeId` argument to a raw user id.
 *
 * Thread assignment FKs `User.id` and is rendered as the actor id `user:<id>`,
 * so an `agent:<Agent.id>` or a record id would match no row at all — the query
 * builder strips whatever prefix it is given and compares the remainder. Both
 * mistakes used to return an empty list; they now name the valid assignees.
 */
async function resolveAssigneeId(
  organizationId: string,
  raw: string
): Promise<{ ok: true; assigneeId: string } | { ok: false; error: string }> {
  const parsed = safeParseActorId(raw)
  if (parsed && parsed.type !== 'user') {
    return {
      ok: false,
      error: `assigneeId must be a user actor id ('user:<id>') — '${raw}' is a ${parsed.type}. Threads are assigned to users; an agent is addressed by its own user id.`,
    }
  }

  const wanted = parsed?.id ?? raw
  const members = await getCachedMembers(organizationId)
  if (members.some((member) => member.userId === wanted)) {
    return { ok: true, assigneeId: wanted }
  }

  return {
    ok: false,
    error: `assigneeId '${raw}' is not a member of this organization. Valid assignees: ${listValues(
      members.map(
        (member) =>
          `${member.user?.name ?? member.user?.email ?? 'unnamed'} (user:${member.userId})`
      )
    )}.`,
  }
}

/**
 * What to try next when a well-formed search matched nothing, so the model does
 * not report "there are none" from an empty list (ported from `search_entities`).
 */
function buildNoResultsSuggestion(args: Record<string, unknown>): string {
  const applied = FILTER_ARGS.filter((key) => args[key] !== undefined).map(
    (key) => `${key}=${JSON.stringify(args[key])}`
  )
  const hints: string[] = []
  if (args.query) {
    hints.push(
      'free-text requires EVERY word to appear in the subject or a message body — try fewer words, or quote a phrase'
    )
  }
  if (args.after || args.before) hints.push('widen the date range (dates are UTC)')
  if (args.status === undefined) {
    hints.push('trash, spam and ignored threads are excluded unless you pass `status` explicitly')
  }
  if (args.tagIds) hints.push('confirm the tag ids with list_tags')
  hints.push('drop one filter at a time to find which one is empty')

  return `No threads matched ${applied.join(', ')}. To narrow down why: ${hints.join('; ')}.`
}

export function createFindThreadsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'find_threads',
    permission: {
      target: 'unmodeled',
      domain: 'mail',
      level: 'view',
      enforcement: 'enforced',
      note: 'ThreadQueryService is constructed with getCachedUserInstanceGrants — invisible threads never enter the result.',
    },
    displayName: 'Find threads',
    toolsetSlug: 'auxx:mail:threads',
    idempotent: true,
    outputSchema: FindThreadsOutput,
    exampleOutput: {
      threads: [
        {
          id: 'thread_8fK2pQ',
          subject: 'Where is my order #1042?',
          status: 'OPEN',
          assigneeId: null,
          sender: { name: 'Jane Doe', identifier: 'jane@example.com' },
          lastMessageAt: '2026-06-05T14:22:00.000Z',
          messageCount: 2,
          isUnread: true,
          tagIds: ['tag_shipping'],
          tags: [{ id: 'tag_shipping', name: 'Shipping', color: 'blue', emoji: null }],
        },
        {
          id: 'thread_3aZ9rL',
          subject: 'Request to change delivery address',
          status: 'OPEN',
          assigneeId: 'user_7Hd2',
          sender: { name: null, identifier: '+4915112345678' },
          lastMessageAt: '2026-06-04T09:10:00.000Z',
          messageCount: 4,
          isUnread: false,
          tagIds: [],
          tags: [],
        },
      ],
      count: 2,
    } satisfies z.output<typeof FindThreadsOutput>,
    buildDigest: (output) => {
      const out = (output ?? {}) as { threads?: Array<Record<string, unknown>>; count?: number }
      const threads = Array.isArray(out.threads) ? out.threads : []
      // `sender` reads the output's own `sender` object. It used to read a
      // top-level `t.sender` string that the output never carried, so the field
      // was always `undefined` — the digest is what survives into compacted
      // context, so a dead field there is a thread the model can only describe
      // by its subject line.
      return {
        count: typeof out.count === 'number' ? out.count : threads.length,
        sample: takeSample(threads).map((t) => {
          const sender = t.sender as { name?: string | null; identifier?: string } | null
          return {
            threadId: String(t.id ?? ''),
            subject: typeof t.subject === 'string' ? t.subject : null,
            sender: sender?.name ?? sender?.identifier ?? undefined,
            lastMessageAt: typeof t.lastMessageAt === 'string' ? t.lastMessageAt : null,
            isUnread: typeof t.isUnread === 'boolean' ? t.isUnread : undefined,
          }
        }),
      }
    },
    description:
      'Search and filter conversation threads across all channels (email, SMS, WhatsApp, Facebook DM, Instagram DM) by status, assignee, inbox, tags, sender, date, or free-text query. Free-text matches subject and message bodies, and every word must appear somewhere in the thread. Returns thread summaries, each with the sender of its most recent message — use get_thread_detail to read the messages themselves. Returns sent threads only; for unsent drafts (saved compositions waiting to send) use list_drafts. At least one filter is required: this tool does not list the whole mailbox and errors rather than substituting a filter of its own. Unless you pass `status`, threads in TRASH, SPAM and IGNORED are excluded — the same default the mail UI applies.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: [...STATUS_VALUES],
          description:
            'Filter by thread status. Omitted, TRASH/SPAM/IGNORED threads are excluded; pass one of these explicitly to search inside it.',
        },
        assigneeId: {
          type: 'string',
          description:
            'Filter by the assigned user — a raw user id or the actor id "user:<id>". Threads are assigned to users only.',
        },
        query: {
          type: 'string',
          description:
            'Free-text search over the subject and the message bodies. Every word must appear somewhere in the thread (subject or any message); wrap a phrase in double quotes to match it as one unit.',
        },
        sender: {
          type: 'string',
          description: 'Filter by sender email or domain',
        },
        tagIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tag IDs — resolve names to ids with list_tags first',
        },
        inboxId: {
          type: 'string',
          description:
            'Filter by inbox — a raw inbox id or an "inbox:<id>" record id. Only inboxes you can see are searchable.',
        },
        after: {
          type: 'string',
          description:
            'Only threads whose last message is later than the start of this day, in UTC. Format YYYY-MM-DD, computed from the current date given in the prompt. The named day itself is included.',
        },
        before: {
          type: 'string',
          description:
            'Only threads whose last message is earlier than the start of this day, in UTC. Format YYYY-MM-DD, computed from the current date given in the prompt. The named day itself is excluded.',
        },
        sharedWithMe: {
          type: 'boolean',
          description:
            'Set true to return only threads explicitly shared with you. Omit it to search everything you can see; false is not accepted.',
        },
        limit: {
          type: 'number',
          description: `Max results (default 10, max ${MAX_RESULTS})`,
        },
        sortBy: {
          type: 'string',
          enum: ['lastMessageAt', 'subject'],
          description: 'Sort field (default: lastMessageAt)',
        },
        sortDirection: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort direction (default: desc)',
        },
      },
      additionalProperties: false,
    },
    validateInputs: async (args) => validateFindThreadsArgs(args),
    execute: async (args, agentDeps) => {
      // Defence in depth: `validateInputs` already rejects a filterless call,
      // but `execute` is reachable directly (evals, replays) so the guard lives
      // on both sides. Never fall back to an unfiltered listing.
      if (buildThreadConditions(args).length === 0) {
        return {
          success: false,
          output: null,
          error: `find_threads needs at least one filter — it does not list the whole mailbox. ${SUPPORTED_ARGS_SENTENCE}`,
        }
      }

      const { db } = getDeps()
      // Kopilot reads mail as the invoking user (§8.1) — never SYSTEM.
      const viewer = await getCachedUserInstanceGrants(agentDeps.userId, agentDeps.organizationId)
      const service = new ThreadQueryService(agentDeps.organizationId, db, viewer)

      // Resolve the id-shaped arguments before querying: an id that names
      // nothing produces an empty list, which reads as "there are none" rather
      // than "you asked for something that doesn't exist".
      const resolved: Record<string, unknown> = { ...args }
      if (typeof args.inboxId === 'string' && args.inboxId !== '') {
        const inbox = await resolveInboxId(agentDeps.organizationId, viewer, args.inboxId)
        if (!inbox.ok) return { success: false, output: null, error: inbox.error }
        resolved.inboxId = inbox.inboxId
      }
      if (typeof args.assigneeId === 'string' && args.assigneeId !== '') {
        const assignee = await resolveAssigneeId(agentDeps.organizationId, args.assigneeId)
        if (!assignee.ok) return { success: false, output: null, error: assignee.error }
        resolved.assigneeId = assignee.assigneeId
      }

      const conditionGroups = buildThreadConditions(resolved)

      // The condition layer drops any condition it cannot build (unknown field,
      // unsupported operator, unusable value) and returns the viewer's whole
      // visible mailbox instead. Build it here first so a dropped filter is an
      // error rather than a silently wider answer.
      const diagnostics = buildConditionGroupsQueryWithDiagnostics(
        conditionGroups,
        agentDeps.organizationId,
        viewer
      )
      if (diagnostics.droppedConditions.length > 0) {
        const detail = diagnostics.droppedConditions
          .map((d) => `${argNameFor(d.conditionId, d.fieldId)} (${d.reason})`)
          .join(', ')
        return {
          success: false,
          output: null,
          error: `find_threads could not apply: ${detail}. Running without it would answer a different question, so nothing was returned. Fix the argument value and retry, or tell the user the filter is unavailable.`,
        }
      }

      const limit = Math.min((args.limit as number) || 10, MAX_RESULTS)

      const { ids } = await service.listThreadIds({
        filter: conditionGroups,
        sort: {
          field: (args.sortBy as 'lastMessageAt' | 'subject') ?? 'lastMessageAt',
          direction: (args.sortDirection as 'asc' | 'desc') ?? 'desc',
        },
        limit,
        userId: agentDeps.userId,
      })

      if (ids.length === 0) {
        return {
          success: true,
          output: { threads: [], count: 0, suggestion: buildNoResultsSuggestion(args) },
        }
      }

      // Extract raw IDs from RecordId format ("thread:abc" → "abc")
      const rawIds = ids.map((id) => {
        const parts = id.split(':')
        return parts.length > 1 ? parts.slice(1).join(':') : id
      })

      const threadMetas = await service.getThreadMetaBatch(rawIds, agentDeps.userId)

      // Resolve tag names so the agent doesn't have to call list_tags after.
      // tagIds on ThreadMeta are RecordIds ("entityDefId:instanceId") — parse to
      // raw instance IDs since update_thread expects those.
      const tagInfo = new Map<
        string,
        { id: string; name: string; color: string; emoji: string | null }
      >()
      if (threadMetas.some((t) => t.tagIds.length > 0)) {
        const tagService = new TagService(agentDeps.organizationId, agentDeps.userId, db)
        const allTags = await tagService.getAllTags()
        for (const tag of allTags) {
          tagInfo.set(tag.id, {
            id: tag.id,
            name: tag.title,
            color: tag.tag_color,
            emoji: tag.tag_emoji,
          })
        }
      }

      // Resolve the sender of each thread's latest message. `ThreadMeta.
      // participants` carries the latest message's envelope as role-prefixed
      // ParticipantIds, which are opaque on their own — one batched lookup
      // turns them into the identity the mail list row shows, so the model can
      // say who wrote instead of inferring it from the subject line.
      const fromByThread = new Map<string, string>()
      for (const meta of threadMetas) {
        const from = meta.participants.map(splitParticipantId).find((p) => p?.role === 'from')
        if (from) fromByThread.set(meta.id, from.id)
      }
      const senderById = new Map<string, { name: string | null; identifier: string }>()
      if (fromByThread.size > 0) {
        const participantService = new ParticipantService(agentDeps.organizationId, db)
        // `limit` is capped at MAX_RESULTS (25), well under the batch's 100.
        const metas = await participantService.getParticipantMetaBatch([
          ...new Set(fromByThread.values()),
        ])
        for (const meta of metas) {
          // `displayName` is a computed friendly handle, so it is only worth
          // reporting when it says something the identifier doesn't — a chat
          // visitor's "Visitor 4f2" is a real answer, "jane@acme.com" repeated
          // as a name is noise.
          const named =
            meta.displayName && meta.displayName !== meta.identifier ? meta.displayName : null
          senderById.set(meta.id, { name: meta.name ?? named, identifier: meta.identifier })
        }
      }

      const threads = threadMetas.map((t) => {
        const instanceIds = t.tagIds.map((rid) => parseRecordId(rid).entityInstanceId)
        const fromId = fromByThread.get(t.id)
        return {
          id: t.id,
          subject: t.subject,
          status: t.status,
          assigneeId: t.assigneeId,
          sender: (fromId ? senderById.get(fromId) : null) ?? null,
          // `ThreadMeta.lastMessageAt` is already an ISO string.
          lastMessageAt: t.lastMessageAt,
          messageCount: t.messageCount,
          isUnread: t.isUnread,
          tagIds: instanceIds,
          tags: instanceIds.map(
            (id) => tagInfo.get(id) ?? { id, name: id, color: 'gray', emoji: null }
          ),
        }
      })

      return {
        success: true,
        output: { threads, count: threads.length },
      }
    },
  }
}
