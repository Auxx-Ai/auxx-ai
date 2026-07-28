// apps/web/src/app/api/attachments/attachment-visibility.ts

import { database, schema } from '@auxx/database'
import { getCachedUserMailVisibility } from '@auxx/lib/cache'
import { getCapabilities, PermissionKey } from '@auxx/lib/permissions'
import { getThreadLens } from '@auxx/lib/permissions/visibility'
import { and, eq } from 'drizzle-orm'

/**
 * Authorization gate for the attachment content routes (`download`, `thumbnail`).
 *
 * The attachment itself carries no access level — its parent does. So this resolves
 * `Attachment.entityType` to the owning record and defers to that record's own gate:
 * the mail lens for `MESSAGE`, `canViewEntity` for record-shaped parents, instance
 * `view` for KB/workflow parents, and the dispatch board capability for QC items.
 *
 * Two invariants hold everywhere below:
 *  - **Fails closed.** An unrecognized `entityType` returns `false`, as does a parent
 *    row that does not resolve inside the caller's organization.
 *  - **Capability-first, DB-second.** Each arm runs its free predicate before issuing
 *    a parent lookup, so a denial costs no extra round trip, and `getCapabilities` is
 *    resolved lazily so `MESSAGE`/`CUSTOM_FIELD` stay at zero capability reads.
 *
 * A missing attachment returns `false` too (invisible ≍ nonexistent), which keeps
 * attachment ids unprobeable across orgs.
 */
export async function canViewAttachment(
  attachmentId: string,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const [attachment] = await database
    .select({
      entityType: schema.Attachment.entityType,
      entityId: schema.Attachment.entityId,
      createdById: schema.Attachment.createdById,
    })
    .from(schema.Attachment)
    .where(
      and(
        eq(schema.Attachment.id, attachmentId),
        eq(schema.Attachment.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!attachment) return false

  let caps: Awaited<ReturnType<typeof getCapabilities>> | undefined
  const capabilities = async () => (caps ??= await getCapabilities(userId, organizationId))

  switch (attachment.entityType) {
    // Mail attachments are `full`-tier (mail-permissions §7): the caller must hold
    // the `full` lens on the parent thread.
    case 'MESSAGE': {
      const [message] = await database
        .select({ threadId: schema.Message.threadId })
        .from(schema.Message)
        .where(
          and(
            eq(schema.Message.id, attachment.entityId),
            eq(schema.Message.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!message) return false

      const viewer = await getCachedUserMailVisibility(userId, organizationId)
      return (await getThreadLens(database, organizationId, viewer, message.threadId)) === 'full'
    }

    // `Comment.entityDefinitionId` is a denormalized column, so the comment's own row
    // resolves the gate's subject without joining `EntityInstance`.
    case 'COMMENT': {
      const [comment] = await database
        .select({ entityDefinitionId: schema.Comment.entityDefinitionId })
        .from(schema.Comment)
        .where(
          and(
            eq(schema.Comment.id, attachment.entityId),
            eq(schema.Comment.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!comment) return false

      return (await capabilities()).canViewEntity(comment.entityDefinitionId)
    }

    // Same shape as COMMENT — `FieldValue.entityDefinitionId` is likewise a column.
    case 'FIELD_VALUE': {
      const [fieldValue] = await database
        .select({ entityDefinitionId: schema.FieldValue.entityDefinitionId })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.id, attachment.entityId),
            eq(schema.FieldValue.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!fieldValue) return false

      return (await capabilities()).canViewEntity(fieldValue.entityDefinitionId)
    }

    // Transient staging rows with no owning record: the uploader writes `entityId` as
    // the synthetic `field-${fieldRef}`
    // (`apps/web/src/components/fields/inputs/hooks/use-field-file-upload.ts`) and the
    // asset is a 24h `TEMP_UPLOAD`. There is nothing to look up, so the uploader is the
    // only viewer.
    case 'CUSTOM_FIELD':
      return attachment.createdById === userId

    // Articles inherit their home KB's access level, matching the tRPC sibling
    // `kb.getArticleById` and the article SSE route.
    case 'ARTICLE': {
      const [article] = await database
        .select({ homeKnowledgeBaseId: schema.Article.homeKnowledgeBaseId })
        .from(schema.Article)
        .where(
          and(
            eq(schema.Article.id, attachment.entityId),
            eq(schema.Article.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!article) return false

      return (await capabilities()).canViewInstance('kb', article.homeKnowledgeBaseId)
    }

    // `entityId` IS the KB id. Confirm the row exists in this org first so a forged id
    // fails closed instead of probing instance access.
    case 'KNOWLEDGE_BASE': {
      const [knowledgeBase] = await database
        .select({ id: schema.KnowledgeBase.id })
        .from(schema.KnowledgeBase)
        .where(
          and(
            eq(schema.KnowledgeBase.id, attachment.entityId),
            eq(schema.KnowledgeBase.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!knowledgeBase) return false

      return (await capabilities()).canViewInstance('kb', attachment.entityId)
    }

    // Deliberately org-membership only. The sole chat-widget read procedure,
    // `getChatWidgetIntegration` (`apps/web/src/server/api/routers/channel.ts`), is a bare
    // `protectedProcedure`, and `ChatWidgetProcessor` marks these assets
    // `fileVisibility: 'PUBLIC'` because the logo renders on the public widget. Gating
    // harder here would be stricter than the tRPC sibling — a separate decision, not this
    // fix.
    case 'CHAT_WIDGET': {
      const [widget] = await database
        .select({ id: schema.ChatWidget.id })
        .from(schema.ChatWidget)
        .where(
          and(
            eq(schema.ChatWidget.id, attachment.entityId),
            eq(schema.ChatWidget.organizationId, organizationId)
          )
        )
        .limit(1)
      return Boolean(widget)
    }

    // The instance key is the parent **`WorkflowApp.id`** (via `WorkflowRun.workflowAppId`),
    // not a `Workflow.id`. The guard throws on system-owned runs rather than returning a
    // boolean, and returns `undefined` when no such run exists in the org.
    case 'WORKFLOW_RUN': {
      const { assertWorkflowRunNotSystemOwned } = await import('@auxx/lib/workflows')
      let workflowAppId: string | undefined
      try {
        workflowAppId = await assertWorkflowRunNotSystemOwned(database, {
          runId: attachment.entityId,
          organizationId,
          isSuperAdmin: false,
          allowSuperAdminRead: false,
        })
      } catch {
        return false
      }
      if (!workflowAppId) return false

      return (await capabilities()).canViewInstance('workflow', workflowAppId)
    }

    // Office/dispatcher path first — `dispatchBoardManage` sees the whole board and costs
    // zero queries. Only a field (worker) seat pays the visit lookup, and `loadOwnVisit`
    // throws Forbidden/NotFound rather than returning a boolean.
    case 'visit_qc_item': {
      if ((await capabilities()).can(PermissionKey.dispatchBoardManage)) return true

      const [item] = await database
        .select({ visitId: schema.VisitQcItem.visitId })
        .from(schema.VisitQcItem)
        .where(
          and(
            eq(schema.VisitQcItem.id, attachment.entityId),
            eq(schema.VisitQcItem.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!item) return false

      const { loadOwnVisit } = await import('@auxx/lib/dispatch')
      try {
        await loadOwnVisit(organizationId, userId, item.visitId)
        return true
      } catch {
        return false
      }
    }

    // Fail closed. `Attachment.entityType` is a free-text column, so the next writer that
    // invents a value ships denied until an arm is added for it.
    default:
      return false
  }
}
