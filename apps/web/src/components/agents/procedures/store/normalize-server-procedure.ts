// apps/web/src/components/agents/procedures/store/normalize-server-procedure.ts
import type { TriggerExample } from '@auxx/lib/agents/procedures/client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { ProcedureMeta } from './procedure-store'

/**
 * Convert a raw `procedure.getById` / `procedure.update` response into a strict
 * {@link ProcedureMeta}. Every server → store handoff goes through here so the
 * store trusts its writers to hand it a fully-shaped value (mirrors
 * `normalize-server-article.ts`). The heavy `draftDoc` is intentionally dropped
 * — the editor owns it.
 */
export function normalizeServerProcedure(server: {
  id: string
  name?: string
  whenToUse?: string | null
  triggerExamples?: unknown
  ruleset?: unknown
  activeVersionId?: string | null
  hasUnpublishedChanges?: boolean
}): ProcedureMeta {
  return {
    id: server.id,
    name: server.name ?? '',
    whenToUse: server.whenToUse ?? '',
    triggerExamples: (server.triggerExamples ?? []) as TriggerExample[],
    ruleset: (server.ruleset ?? []) as ConditionGroup[],
    activeVersionId: server.activeVersionId ?? null,
    hasUnpublishedChanges: !!server.hasUnpublishedChanges,
  }
}
