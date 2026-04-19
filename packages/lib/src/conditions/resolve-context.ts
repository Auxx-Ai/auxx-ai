// packages/lib/src/conditions/resolve-context.ts

import type { Condition, ConditionGroup } from './types'

/**
 * Request context used to resolve value-source placeholders in conditions.
 *
 * `currentUserId` is the authenticated viewer's user ID. When missing (service
 * tokens, cron jobs, anonymous requests), conditions with `valueSource` are
 * dropped rather than substituted with an empty string.
 */
export interface ConditionContext {
  currentUserId?: string
}

/**
 * Walk condition groups and substitute `valueSource` placeholders with concrete
 * values from the request context.
 *
 * Must be called BEFORE passing filters to `getOrCreateSnapshot` so the
 * snapshot cache key differs per viewer.
 */
export function resolveConditionContext(
  groups: ConditionGroup[],
  ctx: ConditionContext
): ConditionGroup[] {
  return groups.map((group) => ({
    ...group,
    conditions: group.conditions.flatMap((c) => resolveCondition(c, ctx)),
  }))
}

function resolveCondition(condition: Condition, ctx: ConditionContext): Condition[] {
  const resolved = condition.subConditions?.length
    ? {
        ...condition,
        subConditions: condition.subConditions.flatMap((c) => resolveCondition(c, ctx)),
      }
    : condition

  if (resolved.valueSource !== 'currentUser') {
    return [resolved]
  }

  const { valueSource: _discard, ...rest } = resolved

  // No viewer context (service token/cron): drop if nothing else would match.
  // For array operators with other values, just drop the placeholder piece.
  if (!ctx.currentUserId) {
    if (Array.isArray(rest.value) && rest.value.length > 0) {
      return [rest]
    }
    return []
  }

  // Array operators (in / not in): merge current user into the existing list.
  if (Array.isArray(rest.value)) {
    const merged = rest.value.includes(ctx.currentUserId)
      ? rest.value
      : [...rest.value, ctx.currentUserId]
    return [{ ...rest, value: merged }]
  }

  // Scalar operators (is / is not): replace value with current user ID.
  return [{ ...rest, value: ctx.currentUserId }]
}
