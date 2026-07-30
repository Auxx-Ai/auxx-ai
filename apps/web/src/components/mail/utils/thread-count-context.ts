// apps/web/src/components/mail/utils/thread-count-context.ts

import { safeParseActorId } from '@auxx/types/actor'
import { getInstanceId } from '@auxx/types/resource'
import type { ThreadMeta } from '~/components/threads/store'

/**
 * Context about a thread needed to calculate which counts to update.
 * Derived from the thread's current state BEFORE the mutation is applied.
 *
 * Both identity fields are **bare instance ids**, because that is the keyspace
 * the sidebar badges live in: `counts.inbox` is compared against the session's
 * bare user id, and `counts.sharedInboxes` is keyed by the bare inbox instance
 * id (`mail-counts.ts` writes `si:{inboxId}`; `toResponse` strips the prefix).
 *
 * The thread store carries neither format — `ThreadMeta.assigneeId` is an
 * `ActorId` and `ThreadMeta.inboxId` is a `RecordId` — so a context must always
 * come from {@link buildThreadCountContext}. The names say `UserId` /
 * `InstanceId` on purpose: a raw `thread.assigneeId` no longer assigns cleanly,
 * which turns the old comment-only contract into a type error (plan 44 §3.5).
 */
export interface ThreadCountContext {
  isUnread: boolean
  /** Bare inbox instance id — NOT the `inbox:` / `personal_inbox:` RecordId. */
  inboxInstanceId: string | null
  /** Bare user id — NOT the `user:` ActorId. */
  assigneeUserId: string | null
  status: 'OPEN' | 'ARCHIVED' | 'TRASH' | 'CLOSED' | 'SPAM'
  /** Full thread data for view filter evaluation */
  threadData?: Record<string, unknown>
}

/**
 * The single producer of a {@link ThreadCountContext}.
 *
 * Normalization goes through the parsers, never a `.replace('user:', '')` /
 * `.replace('inbox:', '')` string strip: the strip matches mid-word and mangles
 * `personal_inbox:<id>` into `personal_<id>`, filing the delta under a key
 * nothing reads — no error, no toast, the badge just stops moving
 * (plan 40 §3 / plan 44 §3.5).
 */
export function buildThreadCountContext(thread: ThreadMeta): ThreadCountContext {
  return {
    isUnread: thread.isUnread,
    inboxInstanceId: thread.inboxId ? getInstanceId(thread.inboxId) : null,
    assigneeUserId: safeParseActorId(thread.assigneeId)?.id ?? null,
    status: thread.status as ThreadCountContext['status'],
    threadData: thread as unknown as Record<string, unknown>,
  }
}
