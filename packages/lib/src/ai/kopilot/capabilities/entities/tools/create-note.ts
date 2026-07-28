// packages/lib/src/ai/kopilot/capabilities/entities/tools/create-note.ts

import { z } from 'zod'
import { CommentService } from '../../../../../comments'
import type { RecordId } from '../../../../../resources/resource-id'
import { textToDoc } from '../../../../../tiptap'
import {
  getKnownDefIds,
  normalizeRecordIdArg,
  parseStringArg,
} from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

/** Full success output of `create_note` — the created comment id and a content preview. */
const CreateNoteOutput = z.object({
  commentId: z.string(),
  recordId: z.string(),
  contentPreview: z.string(),
})

export function createCreateNoteTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'create_note',
    permission: {
      target: 'definition',
      level: 'edit',
      enforcement: 'unenforced',
      note: 'KNOWN GAP (19b G3). Deliberate: the human comment routers are ungated too (doc 14 §8.3), so gating only the agent path would diverge from the product. A def published None still accepts notes. Do not "fix" without the matching human-router decision.',
    },
    displayName: 'Add note',
    toolsetSlug: 'auxx:comments:write',
    outputSchema: CreateNoteOutput,
    exampleOutput: {
      commentId: 'comment_5tR8wK',
      recordId: 'contact:9aB3xY',
      contentPreview: 'Customer requested a callback on Friday afternoon.',
    } satisfies z.output<typeof CreateNoteOutput>,
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
      // KNOWN GAP (plan 19b, G3): deliberately ungated. The *human* comment
      // routers are ungated too (doc 14 §8.3), so gating only the agent path
      // would diverge from the surface it mirrors. The four record-adjacent
      // READS (`list_notes`, `list_field_changes`, `get_transcript`,
      // `list_transcripts_for_entity`) do NOT share this reasoning and are
      // gated on `canViewEntity`. Close this together with the human routers.
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
