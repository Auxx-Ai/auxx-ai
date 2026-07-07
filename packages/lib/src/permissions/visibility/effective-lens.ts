// packages/lib/src/permissions/visibility/effective-lens.ts

import type { AutomationVisibility, ThreadVisibilityInput, UserMailVisibility } from './context'
import { DERIVATION_RULES } from './derivation-rules'
import { type Lens, maxLens } from './lens'

/**
 * The evaluator (§4) — pure and synchronous. All IO happened when the
 * `UserMailVisibility` was cached and when the caller loaded the thread rows,
 * so this is 0 queries in the common case.
 *
 * Framing:
 * - Admins get `full` everywhere EXCEPT others' personal inboxes, where they
 *   start at `metadata` and are raised only by explicit grants / assignment
 *   like anyone else (owners hold a Manager grant, so their own personal inbox
 *   resolves to `full` via `inboxLens`).
 * - Assignment ⇒ `full` on that thread.
 * - Otherwise fold the derivation-rule registry with `maxLens`.
 */
export function effectiveLens(vis: UserMailVisibility, t: ThreadVisibilityInput): Lens {
  const personal = t.inboxId ? (vis.personalInboxIds[t.inboxId] ?? false) : false
  if (vis.isAdmin && !personal) return 'full'
  if (t.assigneeId && t.assigneeId === vis.userId) return 'full'

  // Admins on a personal inbox start at metadata; everyone else at none.
  let lens: Lens = vis.isAdmin && personal ? 'metadata' : 'none'
  for (const rule of DERIVATION_RULES) {
    lens = maxLens(lens, rule.lens(vis, t))
    if (lens === 'full') break
  }
  return lens
}

/**
 * The viewer's lens on an INBOX (not a thread) — the floor every thread in it
 * inherits before per-thread derivations. Mirrors the admin short-circuit in
 * {@link effectiveLens}: admins are `full` everywhere except others' personal
 * inboxes. Used by realtime subscribe auth and the FE `myLenses` read.
 */
export function inboxLensFor(vis: UserMailVisibility, inboxId: string): Lens {
  if (vis.isAdmin && !vis.personalInboxIds[inboxId]) return 'full'
  return vis.inboxLens[inboxId] ?? 'none'
}

/**
 * The automation evaluator (§8.2) — `full` everywhere except personal inboxes
 * (§11), where automation has zero access. Null-inbox threads read as org data.
 */
export function automationLens(vis: AutomationVisibility, t: ThreadVisibilityInput): Lens {
  return t.inboxId && vis.personalInboxIds[t.inboxId] ? 'none' : 'full'
}

/** Batch form — a loop over {@link effectiveLens}, keyed by thread id. */
export function effectiveLensBatch(
  vis: UserMailVisibility,
  threads: readonly ThreadVisibilityInput[]
): Map<string, Lens> {
  const out = new Map<string, Lens>()
  for (const t of threads) out.set(t.threadId, effectiveLens(vis, t))
  return out
}
