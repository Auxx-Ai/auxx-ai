// packages/lib/src/ai/kopilot/capabilities/entities/tools/get-transcript.ts

import { schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const DEFAULT_MAX_TOKENS = 4000
/** Rough char→token ratio for safe truncation. */
const CHARS_PER_TOKEN = 4

/**
 * Full success output of `get_transcript`. Two shapes by granularity:
 * `full_text` returns `fullText` + `totalWords`; `utterances` returns the
 * `utterances` array. `fullText`/`totalWords` and `utterances` are mutually
 * exclusive per call.
 */
const GetTranscriptOutput = z.object({
  transcriptId: z.string(),
  truncated: z.boolean(),
  fullText: z.string().optional(),
  totalWords: z.number().optional(),
  utterances: z
    .array(
      z.object({
        speakerName: z.string().nullable(),
        text: z.string(),
        startMs: z.number(),
        endMs: z.number(),
      })
    )
    .optional(),
})

export function createGetTranscriptTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_transcript',
    permission: {
      target: 'definition',
      level: 'view',
      enforcement: 'enforced',
      note: 'Transcript → CallRecording → EntityInstance join then canViewEntity; not-found on denial (19b G3).',
    },
    displayName: 'Get transcript',
    toolsetSlug: 'auxx:entities:search',
    category: 'system',
    idempotent: true,
    outputSchema: GetTranscriptOutput,
    exampleOutput: {
      transcriptId: 'transcript_1pQ4sW',
      truncated: false,
      fullText:
        'Alex: Thanks for joining the onboarding call. Jane: Happy to be here — excited to get started.',
      totalWords: 18,
    } satisfies z.output<typeof GetTranscriptOutput>,
    buildDigest: (output) => {
      const out = (output ?? {}) as { transcriptId?: string }
      return {
        recordingId: typeof out.transcriptId === 'string' ? out.transcriptId : '',
      }
    },
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
      const { db, capabilities } = getDeps()
      const transcriptId = args.transcriptId as string
      const granularity =
        (args.granularity as 'full_text' | 'utterances' | undefined) ?? 'full_text'
      const maxTokens = (args.maxTokens as number | undefined) ?? DEFAULT_MAX_TOKENS
      const charBudget = maxTokens * CHARS_PER_TOKEN

      // A transcript is reachable only through its meeting record, so the join
      // carries the owning def up for the read gate below (both FKs are
      // NOT NULL + cascade, so the chain always resolves for a live row).
      const [transcript] = await db
        .select({
          fullText: schema.Transcript.fullText,
          wordCount: schema.Transcript.wordCount,
          entityDefinitionId: schema.EntityInstance.entityDefinitionId,
        })
        .from(schema.Transcript)
        .innerJoin(
          schema.CallRecording,
          eq(schema.CallRecording.id, schema.Transcript.callRecordingId)
        )
        .innerJoin(
          schema.EntityInstance,
          eq(schema.EntityInstance.id, schema.CallRecording.meetingId)
        )
        .where(
          and(
            eq(schema.Transcript.id, transcriptId),
            eq(schema.Transcript.organizationId, agentDeps.organizationId)
          )
        )
        .limit(1)

      // Read enforcement (§3): an unviewable meeting def reads exactly like a
      // transcript that does not exist — the message must not distinguish them.
      if (
        !transcript ||
        (capabilities && !capabilities.canViewEntity(transcript.entityDefinitionId))
      ) {
        return { success: false, output: null, error: `Transcript ${transcriptId} not found.` }
      }

      if (granularity === 'full_text') {
        const fullText = transcript.fullText ?? ''
        const truncated = fullText.length > charBudget
        return {
          success: true,
          output: {
            transcriptId,
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
        output: { transcriptId, utterances: out, truncated },
      }
    },
  }
}
