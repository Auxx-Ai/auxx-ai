// packages/lib/src/kb/knowledge-base-kind.ts

/**
 * Knowledge-base kinds that the **platform** provisions and owns, rather than a
 * member creating them.
 *
 * Today: `learned` (AI Memory), created idempotently by `kb.ensureLearnedMemory`
 * and written by `upsert_learned_article`. `source` KBs are platform-owned too,
 * but they are not in this set because they never reach a member-facing surface
 * at all (`listKnowledgeBases` excludes them, and so does
 * `permissions/capabilities/article-visibility-scope`'s `HIDDEN_KB_KINDS`) —
 * there is no affordance on them to narrow. This set is specifically about KBs
 * a member CAN see and therefore might act on.
 */
const SYSTEM_PROVISIONED_KB_KINDS: ReadonlySet<string> = new Set(['learned'])

/**
 * Whether a KB of this `kind` is platform-provisioned, and therefore must not
 * offer **Delete** on any surface (plan v3/06 P4).
 *
 * ## Why delete specifically, and why not Settings
 *
 * Deleting AI Memory is a **content purge wearing a delete button's clothes**:
 * `ensureLearnedMemory` re-provisions the KB on the next learned write, so the
 * container comes straight back — minus every memory the org had accumulated.
 * The control does not do what its label says.
 *
 * Settings deliberately STAYS. The Share dialog behind it is the entire reason
 * plan v3/06 §6.2 wanted the learned KB listed in `kb.list` at all: while it was
 * filtered out, no `kb` `ResourceAccess` row could be authored against it and
 * its access was decided solely by the coarse `knowledgeBase` area fallback.
 * Removing Settings would undo the phase.
 *
 * ⚠ Keyed on `kind`, never on a name or an id — the name is user-editable and
 * the id is per-org, so either would be a rule that quietly stops matching.
 *
 * ⚠ **This is an affordance, not a guard.** `kb.delete` gates on
 * `assertAdminInstance('kb', id)` only and does not refuse `kind: 'learned'`, so
 * a direct mutation still deletes AI Memory. Hiding the button narrows the path
 * a user can stumble down; it does not close the mutation.
 */
export function isSystemProvisionedKnowledgeBase(kind: string | null | undefined): boolean {
  return !!kind && SYSTEM_PROVISIONED_KB_KINDS.has(kind)
}
