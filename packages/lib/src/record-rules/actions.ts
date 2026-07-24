// packages/lib/src/record-rules/actions.ts
// Rule action executors. Heavy dependencies (crud handler, queues, notifications)
// are lazy-imported at call time — this module is reachable from the field-hooks
// registry and must not create import cycles or break vi.mock in unit tests.

import { createScopedLogger } from '@auxx/logger'
import { toActorId } from '@auxx/types/actor'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import type { TiptapDoc } from '../tiptap/types'
import { isActionDoc } from './client'
import type { RecordSnapshot } from './resolver'
import type { CachedRecordRule, RecordRuleAction, RecordRuleFireContext } from './types'

const logger = createScopedLogger('record-rules-actions')

/**
 * `create-task` dedupe/completion cooldown window (decision 7): a task manually
 * completed within this many days of the same rule+record firing again is treated as
 * still "handled" — skip recreating it. Older completions no longer block.
 */
const CREATE_TASK_COOLDOWN_DAYS = 7

/**
 * Batch event shape a native rule handler receives — signature-compatible with the
 * legacy `FieldTriggerHandler` (`field-hooks/types.ts`) so manufacturing triggers can
 * be wrapped unchanged when they migrate onto system rules (see B2 plan D11).
 */
export interface NativeRuleHandlerEvent {
  recordIds: RecordId[]
  organizationId: string
  userId?: string
  /** Lifecycle transition for entity rules (`created`/`deleted`); absent for field firings. */
  action?: 'created' | 'deleted'
  /**
   * Raw event values per record (systemAttribute-keyed), forwarded from the dispatching
   * door. Present for lifecycle firings that captured create/delete-time values; absent for
   * field-change firings. Entity-trigger wrappers read the per-record entry to reconstruct
   * the legacy `EntityTriggerEvent.values`.
   */
  eventDataByRecordId?: Record<RecordId, Record<string, unknown>>
}

export type NativeRuleHandler = (event: NativeRuleHandlerEvent) => Promise<void>

const nativeHandlers = new Map<string, NativeRuleHandler>()

/**
 * Register a native rule handler under a stable key. Called at module init by the
 * server-side declarations that back system rules — NEVER from user input.
 */
export function registerNativeRuleHandler(key: string, fn: NativeRuleHandler): void {
  nativeHandlers.set(key, fn)
}

/** Look up a registered native handler; `undefined` when the key is unknown. */
export function getNativeRuleHandler(key: string): NativeRuleHandler | undefined {
  return nativeHandlers.get(key)
}

/** Test-only: clear the native handler registry. */
export function __clearNativeRuleHandlers(): void {
  nativeHandlers.clear()
}

/**
 * Resolve one text-bearing action field (create-task title / notify message) — a
 * placeholder-token doc (plans/signals/07-action-placeholders.md). Builds the token
 * context once per call. Defensive guard: a plain string (stale seeded row) passes
 * through verbatim without any context lookups. Lazy-imports the resolver — it reaches
 * the placeholders/cache cluster.
 */
async function resolveActionTextField(
  value: TiptapDoc | string,
  ctx: RecordRuleFireContext
): Promise<string> {
  if (typeof value === 'string') return value
  const { buildRuleTokenContext, resolveActionDocToText } = await import('./resolve-action-tokens')
  return resolveActionDocToText(value, await buildRuleTokenContext(ctx))
}

/**
 * Execute one action. Returns the outcome status; throws on failure (the engine
 * catches and records it — continue-and-report).
 */
export async function executeRuleAction(
  action: RecordRuleAction,
  rule: CachedRecordRule,
  ctx: RecordRuleFireContext,
  snapshot: RecordSnapshot | null
): Promise<'ok' | 'skipped'> {
  switch (action.type) {
    case 'set-field': {
      // `deleted` firings have no record left to write onto.
      if (rule.on === 'deleted') return 'skipped'
      // Doc-shaped values resolve placeholder tokens (a solo token keeps the raw typed
      // value); raw static values (string/number/boolean) write verbatim.
      let value = action.value
      if (isActionDoc(action.value)) {
        const { buildRuleTokenContext, resolveActionValue } = await import(
          './resolve-action-tokens'
        )
        value = await resolveActionValue(action.value, await buildRuleTokenContext(ctx))
      }
      const [{ UnifiedCrudHandler }, { SystemUserService }] = await Promise.all([
        import('../resources/crud/unified-handler'),
        import('../users/system-user-service'),
      ])
      const systemUserId = await SystemUserService.getSystemUserForActions(ctx.organizationId)
      const handler = new UnifiedCrudHandler(ctx.organizationId, systemUserId)
      await handler.update(toRecordId(ctx.entityDefinitionId, ctx.entityInstanceId), {
        // fieldRef may be a field row id OR a systemAttribute — the mutation-side
        // field resolution accepts both.
        [action.fieldRef]: value,
      })
      return 'ok'
    }

    case 'enqueue-workflow': {
      const { getOrgCache } = await import('../cache')
      const app = await getOrgCache()
        .from(ctx.organizationId, 'workflowApps')
        .byAppId(action.workflowAppId)
      if (!app?.publishedWorkflow) {
        logger.warn('Rule action skipped — workflow not published or disabled', {
          organizationId: ctx.organizationId,
          workflowAppId: action.workflowAppId,
        })
        return 'skipped'
      }
      const [{ getQueue }, { Queues }] = await Promise.all([
        import('../jobs/queues'),
        import('../jobs/queues/types'),
      ])
      await getQueue(Queues.workflowDelayQueue).add('executeResourceTrigger', {
        workflowAppId: app.id,
        workflowId: app.publishedWorkflow.id,
        organizationId: ctx.organizationId,
        entityDefinitionId: ctx.entityDefinitionId,
        resourceData: snapshot ?? {
          id: ctx.entityInstanceId,
          entityDefinitionId: ctx.entityDefinitionId,
        },
        triggerType:
          rule.on === 'created' ? 'created' : rule.on === 'deleted' ? 'deleted' : 'updated',
        triggeredAt: new Date().toISOString(),
        // Rule-trigger context — a superset of the resource-trigger payload.
        recordRule: {
          ruleId: rule.id,
          ruleName: rule.name,
          fieldId: ctx.fieldId,
          oldValue: ctx.oldValue,
          newValue: ctx.newValue,
        },
      })
      return 'ok'
    }

    case 'notify': {
      // Placeholder-token docs flatten to text (stale plain strings send verbatim).
      const message = await resolveActionTextField(action.message, ctx)
      const { NotificationService } = await import('../notifications/notification-service')
      const notifications = new NotificationService()
      for (const userId of action.userIds) {
        await notifications.sendNotification({
          type: 'SYSTEM_MESSAGE',
          userId,
          targetType: 'ENTITY_INSTANCE',
          targetIds: {
            entityDefinitionId: ctx.entityDefinitionId,
            entityInstanceId: ctx.entityInstanceId,
          },
          message,
          organizationId: ctx.organizationId,
          metadata: {
            kind: 'SYSTEM_MESSAGE',
            source: 'record-rule',
            ruleId: rule.id,
            ruleName: rule.name,
            fieldId: ctx.fieldId,
          },
        })
      }
      return 'ok'
    }

    case 'create-task': {
      // `deleted` firings have no record left to reference sensibly.
      if (rule.on === 'deleted') return 'skipped'

      const [{ database, schema }, { and, eq, gte, isNull, or }] = await Promise.all([
        import('@auxx/database'),
        import('drizzle-orm'),
      ])

      // Dedupe + completion cooldown (decision 7): one query joining Task + TaskReference,
      // org-scoped, on the `(organizationId, sourceRuleId)` index — skip when a
      // non-archived task from this same rule already references this record and is
      // either still open or was completed within the cooldown window.
      const cooldownCutoff = new Date(Date.now() - CREATE_TASK_COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
      const [duplicate] = await database
        .select({ id: schema.Task.id })
        .from(schema.Task)
        .innerJoin(schema.TaskReference, eq(schema.TaskReference.taskId, schema.Task.id))
        .where(
          and(
            eq(schema.Task.organizationId, ctx.organizationId),
            eq(schema.Task.sourceRuleId, rule.id),
            isNull(schema.Task.archivedAt),
            eq(schema.TaskReference.referencedEntityInstanceId, ctx.entityInstanceId),
            isNull(schema.TaskReference.deletedAt),
            or(isNull(schema.Task.completedAt), gte(schema.Task.completedAt, cooldownCutoff))
          )
        )
        .limit(1)

      if (duplicate) {
        logger.debug('Rule create-task skipped — dedupe/cooldown match', {
          organizationId: ctx.organizationId,
          ruleId: rule.id,
          entityInstanceId: ctx.entityInstanceId,
        })
        return 'skipped'
      }

      // Title resolution — placeholder-token docs flattened to text.
      const title = await resolveActionTextField(action.title, ctx)

      const [{ createTaskService }, { SystemUserService }] = await Promise.all([
        import('../tasks'),
        import('../users/system-user-service'),
      ])
      const systemUserId = await SystemUserService.getSystemUserForActions(ctx.organizationId)

      // Fired record + (when the signal carries a distinct contact) the contact too —
      // deduped by instance id.
      const referencedEntities: RecordId[] = [
        toRecordId(ctx.entityDefinitionId, ctx.entityInstanceId),
      ]
      if (
        ctx.signal?.contactEntityInstanceId &&
        ctx.signal.contactEntityInstanceId !== ctx.entityInstanceId
      ) {
        referencedEntities.push(
          toRecordId(ctx.entityDefinitionId, ctx.signal.contactEntityInstanceId)
        )
      }

      await createTaskService(database).createTask(
        {
          title,
          priority: action.priority,
          assigneeActorIds: action.assigneeIds?.map((id) => toActorId('user', id)),
          referencedEntities,
          source: 'rule',
          sourceRuleId: rule.id,
          sourceSignalId: ctx.signal?.signalId,
          autoCompleteOn: action.autoCompleteOn,
          deadline: action.deadlineDays != null ? { days: action.deadlineDays } : undefined,
        },
        ctx.organizationId,
        systemUserId
      )

      return 'ok'
    }

    case 'native':
      // Native actions are dispatched once-per-rule by the batch entry point
      // (`fireRecordRulesBatch`), never through the per-record path. Defensive skip
      // keeps the switch exhaustive.
      return 'skipped'
  }
}
