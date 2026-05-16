// packages/lib/src/ai/kopilot/capabilities/entities/tools/create-note.ts

import { CommentService } from '../../../../../comments'
import type { RecordId } from '../../../../../resources/resource-id'
import { textToDoc } from '../../../../../tiptap'
import {
  getKnownDefIds,
  normalizeRecordIdArg,
  parseStringArg,
} from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { CreateNoteDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'

export function createCreateNoteTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'create_note',
    displayName: 'Add note',
    toolsetSlug: 'comments.write',
    outputDigestSchema: CreateNoteDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as { commentId?: string; recordId?: string }
      return {
        noteId: String(out.commentId ?? ''),
        entityId: typeof out.recordId === 'string' ? out.recordId : undefined,
      }
    },
    description:
      'Add a new internal note (a.k.a. comment) to a record. Use whenever the user asks to leave a note, add a comment, drop a remark, or annotate a record. To mention a record (user, agent, contact, ticket, etc.), embed `@[<recordId>]` in the content — e.g. `@[user:abc123]` or `@[agent:my-agent]`. The recordId form is `<entityDefinitionId>:<entityInstanceId>`, the same shape returned by `search_entities`, `list_entities`, etc. User and agent mentions auto-fire the appropriate notification or trigger.',
    parameters: {
      type: 'object',
      properties: {
        recordId: {
          type: 'string',
          description: 'Record ID (format: entityDefinitionId:entityInstanceId).',
        },
        content: {
          type: 'string',
          description:
            'Note body in plain text. Use `@[<recordId>]` to mention a record (the same recordId form returned by search/list tools). Paragraphs split on blank lines.',
        },
      },
      required: ['recordId', 'content'],
      additionalProperties: false,
    },
    validateInputs: async (args, ctx) => {
      const known = await getKnownDefIds(ctx.organizationId)
      const recordId = normalizeRecordIdArg(args.recordId, {
        knownDefIds: known,
        argName: 'recordId',
      })
      if (!recordId.ok) return { ok: false, error: recordId.error }
      const content = parseStringArg(args.content, {
        name: 'content',
        required: true,
        max: 50000,
      })
      if (!content.ok) return { ok: false, error: content.error }
      return {
        ok: true,
        args: { ...args, recordId: recordId.value, content: content.value },
        warnings: recordId.warnings,
      }
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const recordId = args.recordId as string
      const content = args.content as string

      const service = new CommentService(agentDeps.organizationId, agentDeps.userId, db)
      const contentJson = textToDoc(content, { parseReferences: true })

      try {
        const comment = await service.createComment({
          recordId: recordId as RecordId,
          contentJson,
          createdById: agentDeps.userId,
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
