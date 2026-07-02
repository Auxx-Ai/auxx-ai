// packages/lib/src/record-rules/actions.ts
// Rule action executors. Heavy dependencies (crud handler, queues, notifications)
// are lazy-imported at call time — this module is reachable from the field-hooks
// registry and must not create import cycles or break vi.mock in unit tests.

import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import type { RecordSnapshot } from './resolver'
import type { CachedRecordRule, RecordRuleAction, RecordRuleFireContext } from './types'

const logger = createScopedLogger('record-rules-actions')

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
      const [{ UnifiedCrudHandler }, { SystemUserService }] = await Promise.all([
        import('../resources/crud/unified-handler'),
        import('../users/system-user-service'),
      ])
      const systemUserId = await SystemUserService.getSystemUserForActions(ctx.organizationId)
      const handler = new UnifiedCrudHandler(ctx.organizationId, systemUserId)
      await handler.update(toRecordId(ctx.entityDefinitionId, ctx.entityInstanceId), {
        // fieldRef may be a field row id OR a systemAttribute — the mutation-side
        // field resolution accepts both.
        [action.fieldRef]: action.value,
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
      const { NotificationService } = await import('../notifications/notification-service')
      const notifications = new NotificationService()
      for (const userId of action.userIds) {
        await notifications.sendNotification({
          type: 'SYSTEM_MESSAGE',
          userId,
          entityId: ctx.entityInstanceId,
          entityType: ctx.entityDefinitionId,
          message: action.message,
          organizationId: ctx.organizationId,
          data: {
            source: 'record-rule',
            ruleId: rule.id,
            ruleName: rule.name,
            fieldId: ctx.fieldId,
          },
        })
      }
      return 'ok'
    }
  }
}
