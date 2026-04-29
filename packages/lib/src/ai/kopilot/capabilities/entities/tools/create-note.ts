// packages/lib/src/ai/kopilot/capabilities/entities/tools/create-note.ts

import { CommentService } from '../../../../../comments'
import { isRecordId, type RecordId } from '../../../../../resources/resource-id'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

export function createCreateNoteTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'create_note',
    description:
      "Add a new internal note (a.k.a. comment) to a record. Use whenever the user asks to leave a note, add a comment, drop a remark, or annotate a record. Mentions of the form '@username' in content are auto-resolved.",
    parameters: {
      type: 'object',
      properties: {
        recordId: {
          type: 'string',
          description: 'Record ID (format: entityDefinitionId:entityInstanceId).',
        },
        content: {
          type: 'string',
          description: 'Note body. Markdown allowed. @username mentions are auto-resolved.',
        },
      },
      required: ['recordId', 'content'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const recordId = args.recordId as string
      const content = args.content as string

      if (!isRecordId(recordId)) {
        return {
          success: false,
          output: null,
          error: `Invalid recordId "${recordId}". Expected "entityDefinitionId:entityInstanceId".`,
        }
      }

      const service = new CommentService(agentDeps.organizationId, agentDeps.userId, db)

      try {
        const mentions = await service.parseMentions(content, agentDeps.organizationId)
        const comment = await service.createComment({
          recordId: recordId as RecordId,
          content,
          createdById: agentDeps.userId,
          mentions,
        })
        return {
          success: true,
          output: {
            commentId: comment.id,
            recordId,
            contentPreview: content.length > 120 ? `${content.slice(0, 120)}…` : content,
          },
        }
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : 'Failed to create note',
        }
      }
    },
  }
}
