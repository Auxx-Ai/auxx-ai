// packages/lib/src/ai/kopilot/capabilities/entities/tools/get-transcript.ts

import { schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const DEFAULT_MAX_TOKENS = 4000
/** Rough char→token ratio for safe truncation. */
const CHARS_PER_TOKEN = 4

export function createGetTranscriptTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_transcript',
    idempotent: true,
    description:
      'Fetch the full text of a transcript, optionally with utterance-level speaker attribution. Token-heavy — call only when transcript content is decision-relevant.',
    parameters: {
      type: 'object',
      properties: {
        transcriptId: {
          type: 'string',
          description: 'Transcript ID (from list_transcripts_for_entity).',
        },
        granularity: {
          type: 'string',
          enum: ['full_text', 'utterances'],
          description:
            '"full_text" (default) returns a single string. "utterances" returns per-speaker segments with timestamps.',
        },
        maxTokens: {
          type: 'number',
          description: `Truncation budget (default ${DEFAULT_MAX_TOKENS}).`,
        },
      },
      required: ['transcriptId'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const transcriptId = args.transcriptId as string
      const granularity =
        (args.granularity as 'full_text' | 'utterances' | undefined) ?? 'full_text'
      const maxTokens = (args.maxTokens as number | undefined) ?? DEFAULT_MAX_TOKENS
      const charBudget = maxTokens * CHARS_PER_TOKEN

      const transcript = await db.query.Transcript.findFirst({
        where: and(
          eq(schema.Transcript.id, transcriptId),
          eq(schema.Transcript.organizationId, agentDeps.organizationId)
        ),
      })

      if (!transcript) {
        return { success: false, output: null, error: `Transcript ${transcriptId} not found.` }
      }

      if (granularity === 'full_text') {
        const fullText = transcript.fullText ?? ''
        const truncated = fullText.length > charBudget
        return {
          success: true,
          output: {
            fullText: truncated ? `${fullText.slice(0, charBudget)}...` : fullText,
            truncated,
            totalWords: transcript.wordCount ?? 0,
          },
        }
      }

      // utterances
      const utterances = await db
        .select({
          startMs: schema.TranscriptUtterance.startMs,
          endMs: schema.TranscriptUtterance.endMs,
          text: schema.TranscriptUtterance.text,
          speakerName: schema.TranscriptSpeaker.name,
        })
        .from(schema.TranscriptUtterance)
        .leftJoin(
          schema.TranscriptSpeaker,
          eq(schema.TranscriptSpeaker.id, schema.TranscriptUtterance.speakerId)
        )
        .where(
          and(
            eq(schema.TranscriptUtterance.transcriptId, transcriptId),
            eq(schema.TranscriptUtterance.organizationId, agentDeps.organizationId)
          )
        )
        .orderBy(asc(schema.TranscriptUtterance.sortOrder))

      const out: Array<{
        speakerName: string | null
        text: string
        startMs: number
        endMs: number
      }> = []
      let usedChars = 0
      let truncated = false
      for (const u of utterances) {
        if (usedChars + u.text.length > charBudget) {
          truncated = true
          break
        }
        out.push({
          speakerName: u.speakerName ?? null,
          text: u.text,
          startMs: u.startMs,
          endMs: u.endMs,
        })
        usedChars += u.text.length
      }

      return {
        success: true,
        output: { utterances: out, truncated },
      }
    },
  }
}
