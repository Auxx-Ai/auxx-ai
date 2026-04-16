// packages/lib/src/recording/ai/prompts/chapter-prompt.ts

import { z } from 'zod'

export interface ChapterContext {
  durationMs: number
}

export function buildChapterSystemPrompt(ctx: ChapterContext): string {
  const totalSeconds = Math.floor(ctx.durationMs / 1000)
  const mm = Math.floor(totalSeconds / 60)
  const ss = totalSeconds % 60
  const duration = `${mm}:${ss.toString().padStart(2, '0')}`

  return [
    'You segment meeting recordings into contiguous, non-overlapping chapters based on a timestamped transcript.',
    `Recording duration: ${duration} (${ctx.durationMs} ms).`,
    '',
    'Return JSON with one field:',
    '  - chapters: an array of 3–12 chapters. Each has:',
    '      title: sentence case, 2–6 words capturing the topic,',
    '      startMs: integer milliseconds from the start of the recording,',
    '      endMs: integer milliseconds from the start of the recording.',
    '',
    'Rules:',
    '- The first chapter starts at 0.',
    '- The last chapter ends at the full recording duration.',
    '- Chapters must be strictly monotonically increasing and non-overlapping.',
    '- Each chapter covers a distinct topic or phase of the conversation (e.g. intro, demo, objections, next steps).',
  ].join('\n')
}

export function buildChapterUserPrompt(timestampedTranscript: string): string {
  return `Timestamped transcript (format: [mm:ss] Speaker: text):\n\n${timestampedTranscript}`
}

export const ChapterResponseSchema = z.object({
  chapters: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        startMs: z.number().int().min(0),
        endMs: z.number().int().min(0),
      })
    )
    .min(1)
    .max(20),
})

export type ChapterResponse = z.infer<typeof ChapterResponseSchema>

export const CHAPTER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['chapters'],
  properties: {
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'startMs', 'endMs'],
        properties: {
          title: { type: 'string' },
          startMs: { type: 'integer', minimum: 0 },
          endMs: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
}
