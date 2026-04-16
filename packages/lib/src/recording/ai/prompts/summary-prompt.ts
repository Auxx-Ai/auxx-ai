// packages/lib/src/recording/ai/prompts/summary-prompt.ts

import { z } from 'zod'

export interface SummaryContext {
  meetingTitle?: string
  participants: { name: string; isHost: boolean }[]
}

export function buildSummarySystemPrompt(ctx: SummaryContext): string {
  const roster =
    ctx.participants.length > 0
      ? ctx.participants.map((p) => `- ${p.name}${p.isHost ? ' (host)' : ''}`).join('\n')
      : '(participants unknown)'

  return [
    'You summarize meeting transcripts into a concise, useful recap.',
    ctx.meetingTitle ? `Meeting title: ${ctx.meetingTitle}` : '',
    'Known participants:',
    roster,
    '',
    'Return strict JSON with two fields:',
    '  - summary: a single paragraph of plain prose (no markdown, no headers, no bullet lists, no line breaks) describing what the meeting covered, key decisions, and outcomes. 150–200 words.',
    '  - actionItems: an array of concrete follow-ups. For each item provide:',
    '      title (required, <= 120 chars),',
    '      description (optional, 1 short sentence),',
    '      owner (optional, free-text name from the transcript; match participant names above when possible),',
    '      dueDate (optional, ISO 8601 YYYY-MM-DD if a date can be extracted),',
    '      priority (optional, one of "low" | "medium" | "high" based on urgency expressed).',
    'If a field is uncertain, omit it rather than guessing. Do not hallucinate content not grounded in the transcript.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildSummaryUserPrompt(fullText: string): string {
  return `Transcript:\n\n${fullText}`
}

export const SummaryResponseSchema = z.object({
  summary: z.string(),
  actionItems: z.array(
    z.object({
      title: z.string(),
      description: z.string().optional(),
      owner: z.string().optional(),
      dueDate: z.string().optional(),
      priority: z.enum(['low', 'medium', 'high']).optional(),
    })
  ),
})

export type SummaryResponse = z.infer<typeof SummaryResponseSchema>

export const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'actionItems'],
  properties: {
    summary: { type: 'string' },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          owner: { type: 'string' },
          dueDate: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
  },
}
