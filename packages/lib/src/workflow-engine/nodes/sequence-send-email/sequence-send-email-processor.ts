// packages/lib/src/workflow-engine/nodes/sequence-send-email/sequence-send-email-processor.ts
// Server-registered node processor for a compiled sequence's per-step send
// (Sequences plan §3.2/§3.3) — wraps `MessageSenderService`. NOT added to the
// user node palette; only `publishSequence` (Phase 2) ever writes a node with
// this `type`.

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { IdentifierType, SendStatus } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import { MessageSenderService } from '../../../messages/message-sender.service'
import type { SendMessageInput } from '../../../messages/types/message-sending.types'
import type { PlaceholderResolutionContext } from '../../../placeholders'
import { resolvePlaceholdersInHtml } from '../../../placeholders'
import { ProviderRegistryService } from '../../../providers/provider-registry-service'
import { buildSequenceUnsubscribeUrl, exitSequenceRun } from '../../../sequences/runtime'
import { SystemUserService } from '../../../users/system-user-service'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'
import type { SequenceSendEmailNodeConfig, SequenceTriggerData } from './types'

/**
 * `MessageSenderService.sendMessage()` does not throw on a provider-level send
 * failure — it returns a `SentMessage` with `sendStatus: 'FAILED'` and a
 * human-readable `error` string (`ErrorNormalizer.getUserMessage()`'s output,
 * see `providers/error-normalization.ts`). The normalized `EmailErrorCode` /
 * `retryable` flag are computed internally but not threaded through the
 * return value, so terminal-vs-retryable classification here matches on the
 * (enum-driven, stable) user-message text for the four codes explicitly
 * marked `retryable: false` there. Anything else — rate limits, network
 * errors, or an unrecognized message — is treated as retryable so the
 * engine's normal retry/backoff handles it instead of prematurely bouncing a
 * run that might succeed on retry.
 */
function isTerminalSendFailure(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false
  if (errorMessage.startsWith('Message too large (max')) return true // SIZE_LIMIT_EXCEEDED
  if (
    errorMessage ===
    'The selected "From" address is not verified for sending. Please check your email settings.'
  ) {
    return true // FROM_ALIAS_INVALID
  }
  if (errorMessage === 'Email authentication failed. Please reconnect your email account.') {
    return true // AUTH_FAILED
  }
  if (errorMessage === 'One or more recipient email addresses are invalid.') {
    return true // INVALID_RECIPIENTS
  }
  return false
}

export class SequenceSendEmailProcessor extends BaseNodeProcessor {
  readonly type = 'sequence-send-email'

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const config = node.data as unknown as SequenceSendEmailNodeConfig

    if (!config.sequenceId) errors.push('sequenceId is required')
    if (!config.stepId) errors.push('stepId is required')
    if (typeof config.stepIndex !== 'number' || config.stepIndex < 1) {
      errors.push('stepIndex must be a positive number')
    }
    if (!config.bodyHtml) errors.push('bodyHtml is required')
    if (!config.integrationId) errors.push('integrationId is required')
    if (config.stepIndex === 1 && !config.subject) {
      errors.push('subject is required for step 1')
    }

    return { valid: errors.length === 0, errors, warnings: [] }
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const config = node.data as unknown as SequenceSendEmailNodeConfig
    const context = contextManager.getContext()
    const database = context.db ?? defaultDb
    const organizationId = context.organizationId

    const triggerData = (await contextManager.getVariable('sys.triggerData')) as
      | SequenceTriggerData
      | undefined

    if (!triggerData?.sequenceRunId) {
      throw this.createConfigurationError(
        'sequence-send-email node requires sys.triggerData.sequenceRunId',
        node
      )
    }

    const run = await database.query.SequenceRun.findFirst({
      where: (t, { eq: eqOp, and }) =>
        and(eqOp(t.id, triggerData.sequenceRunId), eqOp(t.organizationId, organizationId)),
    })

    if (!run) {
      throw this.createExecutionError(`SequenceRun ${triggerData.sequenceRunId} not found`, node, {
        sequenceRunId: triggerData.sequenceRunId,
      })
    }

    if (run.status !== 'active') {
      // Safety net — the normal exit paths (reply/bounce/unsubscribe/manual)
      // already stop the workflow, so this node shouldn't run again after an
      // exit. Guards against a race (e.g. a reply landing right as this node
      // was dequeued) without failing the run.
      contextManager.log('INFO', node.name, 'Skipping send — run is not active', {
        sequenceRunId: run.id,
        status: run.status,
      })
      return {
        status: NodeRunningStatus.Succeeded,
        output: { skipped: true, reason: 'run-not-active' },
        outputHandle: 'source',
      }
    }

    try {
      // ── Resolve placeholders against the frozen recipient ──────────────────
      const entityDefs = await getOrgCache().get(organizationId, 'entityDefs')
      const recordIdsByRoot = new Map<string, RecordId>()
      if (entityDefs.contact && run.recipientEntityInstanceId) {
        recordIdsByRoot.set(
          entityDefs.contact,
          toRecordId('contact', run.recipientEntityInstanceId)
        )
      }
      const placeholderCtx: PlaceholderResolutionContext = {
        db: database,
        organizationId,
        recordIdsByRoot,
      }
      let resolvedHtml = await resolvePlaceholdersInHtml(config.bodyHtml, placeholderCtx)

      // ── Unsubscribe footer ───────────────────────────────────────────────────
      const unsubscribeUrl = buildSequenceUnsubscribeUrl(run.unsubscribeToken)
      resolvedHtml += `<p style="color:#8a8a8a;font-size:12px;margin-top:24px;"><a href="${unsubscribeUrl}" target="_blank" rel="noopener noreferrer" style="color:#8a8a8a;">Unsubscribe</a></p>`

      // ── Subject: step 1 opens the thread; steps 2..N reply into it ─────────
      const subject = await this.resolveSubject(config, run, database)

      // ── Send ─────────────────────────────────────────────────────────────────
      const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
      const providerRegistry = new ProviderRegistryService(organizationId)
      const messageSender = new MessageSenderService(organizationId, providerRegistry, database)

      const sendInput: SendMessageInput = {
        userId: systemUserId,
        organizationId,
        integrationId: config.integrationId,
        threadId: run.threadId ?? undefined,
        subject,
        textHtml: resolvedHtml,
        signatureId: config.signatureId ?? undefined,
        to: [{ identifier: run.recipientEmail, identifierType: IdentifierType.EMAIL }],
        attachmentIds: config.attachmentIds,
      }

      contextManager.log('INFO', node.name, 'Sending sequence step email', {
        sequenceRunId: run.id,
        stepIndex: config.stepIndex,
        integrationId: config.integrationId,
        threadId: run.threadId,
      })

      const sent = await messageSender.sendMessage(sendInput)

      if (sent.sendStatus === SendStatus.FAILED) {
        const terminal = isTerminalSendFailure(sent.error)

        contextManager.log('ERROR', node.name, 'Sequence step send failed', {
          sequenceRunId: run.id,
          stepIndex: config.stepIndex,
          terminal,
          error: sent.error,
        })

        if (terminal) {
          // Bounce-exit the run; the workflow itself is stopped by this
          // node's own throw below (via the engine's normal failure path),
          // so `stopWorkflow: false` avoids a redundant stopWorkflowRun call.
          await exitSequenceRun(database, {
            sequenceRunId: run.id,
            organizationId,
            reason: 'bounce',
            metadata: { error: sent.error },
            stopWorkflow: false,
          })
        }

        throw this.createExecutionError(sent.error || 'Message send failed', node, {
          sequenceRunId: run.id,
          stepIndex: config.stepIndex,
          terminal,
        })
      }

      // ── Success bookkeeping ───────────────────────────────────────────────────
      await database
        .update(schema.SequenceRun)
        .set({
          threadId: sent.threadId,
          lastCompletedStep: config.stepIndex,
          lastSentAt: new Date(),
        })
        .where(eq(schema.SequenceRun.id, run.id))

      return {
        status: NodeRunningStatus.Succeeded,
        output: { messageId: sent.id, threadId: sent.threadId, stepIndex: config.stepIndex },
        outputHandle: 'source',
      }
    } catch (error) {
      contextManager.log('ERROR', node.name, 'Failed to send sequence step email', {
        sequenceRunId: run.id,
        stepIndex: config.stepIndex,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Step 1 (or any step before a thread exists yet) uses the configured
   * subject verbatim. Steps 2..N reply into the existing thread — mirrors
   * the `"Re: " + subject` convention established by the Answer node
   * (`action-nodes/answer.ts`) and the Kopilot reply-to-thread tool.
   */
  private async resolveSubject(
    config: SequenceSendEmailNodeConfig,
    run: { threadId: string | null },
    database: Database
  ): Promise<string> {
    if (config.stepIndex === 1 || !run.threadId) {
      if (!config.subject) {
        throw new Error('Step 1 requires a subject')
      }
      return config.subject
    }

    const [thread] = await database
      .select({ subject: schema.Thread.subject })
      .from(schema.Thread)
      .where(eq(schema.Thread.id, run.threadId))
      .limit(1)

    const baseSubject = thread?.subject || config.subject || 'Your message'
    return baseSubject.startsWith('Re:') ? baseSubject : `Re: ${baseSubject}`
  }
}
