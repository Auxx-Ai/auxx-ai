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
 * - Assignment ⇒ `full` on that thread. Ungated core collaboration on every
 *   plan (`plans/mail-permissions/02-architecture.md` §11.3, plan 40 §2) — it
 *   must never acquire a v2 gate, and it is what makes the dispatch/controller
 *   pattern work against a floor-`none` inbox.
 * - Otherwise fold the derivation-rule registry with `maxLens`, starting at
 *   `none`.
 *
 * **No rank branch (plan 40 §4.2).** The two `isAdmin` short-circuits that used
 * to sit here — `full` everywhere, and `metadata` on others' personal inboxes —
 * are gone. Both answers now arrive through `inboxLens`, which
 * `composeUserMailVisibility` builds from `ResourceAccess` rows plus the
 * `Area.inboxes` fallback (and, for a mail admin, the §4.4 personal `metadata`
 * floor). A default admin's numbers are unchanged; a downgraded one really loses
 * mail, which is the point.
 */
export function effectiveLens(vis: UserMailVisibility, t: ThreadVisibilityInput): Lens {
  if (t.assigneeId && t.assigneeId === vis.userId) return 'full'

  let lens: Lens = 'none'
  for (const rule of DERIVATION_RULES) {
    lens = maxLens(lens, rule.lens(vis, t))
    if (lens === 'full') break
  }
  return lens
}

/**
 * The viewer's lens on an INBOX (not a thread) — the floor every thread in it
 * inherits before per-thread derivations. Used by realtime subscribe auth and
 * the FE `myLenses` read.
 *
 * A plain map read since plan 40 §4.2: the composed floor already carries the
 * area fallback and the mail-admin personal cap, so this and {@link effectiveLens}
 * can no longer disagree about an inbox (they did before — this function returned
 * `none` to an admin on a personal mailbox while the evaluator returned
 * `metadata`).
 */
export function inboxLensFor(vis: UserMailVisibility, inboxId: string): Lens {
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
