// packages/lib/src/field-hooks/pre/tag-template-guard.ts

import { ForbiddenError } from '../../errors'
import type { EntityPreDeleteHandler, FieldPreHookHandler } from '../types'

/**
 * Silently drop any user-supplied write to `tag_template_key`. Only the seeder
 * (which puts `tag_template_key` in `ctx.bypassFieldGuards`) may stamp it — every
 * other caller's value is discarded.
 *
 * ⚠️ This hook is what actually enforces invariant 2
 * (plans/mail-filter/06-mail-categories-rework-plan.md §3.2): the registry's
 * `capabilities.creatable/updatable: false` is documentation only, since the
 * field-value write path never reads capabilities. Without this hook any caller
 * could stamp a template key on their own tag and make it permanently
 * undeletable via {@link rejectDeleteIfTemplateTag}. Same construction as
 * `dropUnauthorizedSystemFlag` for `is_system_tag`.
 *
 * The framework short-circuits this hook when the bypass set contains
 * `tag_template_key`, so this body only runs for unauthorized writes.
 */
export const dropUnauthorizedTemplateKey: FieldPreHookHandler = async () => undefined

/**
 * Reject a delete when the target carries a `tag_template_key` — a seeded mail
 * category is undeletable (D4). Mirrors `rejectDeleteIfSystemTag`, different
 * predicate: this one is a TEXT marker rather than a boolean flag.
 *
 * ⚠️ Deliberately the ONLY guard this marker carries. There is no
 * `rejectIfSystemTag`-style freeze on title, emoji, colour, parent or
 * `tag_description` — a seeded category must stay fully editable, because the
 * description is the classifier's instruction and what "Support" means differs
 * per business (§3.2, D5).
 *
 * `event.values` is pre-captured by the pre-delete fire point (systemAttribute
 * keyed), so no extra read is needed.
 */
export const rejectDeleteIfTemplateTag: EntityPreDeleteHandler = async (event) => {
  const templateKey = event.values.tag_template_key
  if (typeof templateKey === 'string' && templateKey.length > 0) {
    throw new ForbiddenError('Seeded categories cannot be deleted')
  }
}
