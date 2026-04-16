// packages/lib/src/recording/ai/prompts/insight-prompt.ts

import { type ZodRawShape, type ZodTypeAny, z } from 'zod'
import type { InsightTemplateSection } from '../types'

export interface InsightTemplateLike {
  title: string
  aiTitle?: string | null
  sections: InsightTemplateSection[]
}

export function slugifyKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildInsightSystemPrompt(template: InsightTemplateLike): string {
  const sectionsDescription = template.sections
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => {
      const key = slugifyKey(s.title)
      const shape = s.type === 'list' ? 'array of short strings' : 'string'
      return `  - "${key}" (${shape}) — ${s.title}. Guidance: ${s.prompt}`
    })
    .join('\n')

  return [
    `You analyze meeting transcripts under the framework "${template.title}".`,
    template.aiTitle ? `Framework description: ${template.aiTitle}` : '',
    '',
    'Produce strict JSON with exactly these keys (no extra keys):',
    sectionsDescription,
    '',
    'Rules:',
    '- Ground every statement in the transcript. Do not hallucinate.',
    '- For list sections, each item must be a concise bullet (ideally < 20 words).',
    '- For plaintext sections, write a tight paragraph (< 120 words).',
    '- If a section has no support in the transcript, return an empty string or empty array.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildInsightUserPrompt(fullText: string): string {
  return `Transcript:\n\n${fullText}`
}

export function buildInsightResponseSchema(
  template: InsightTemplateLike
): z.ZodObject<ZodRawShape> {
  const shape: ZodRawShape = {}
  for (const section of template.sections) {
    const key = slugifyKey(section.title)
    const sectionSchema: ZodTypeAny = section.type === 'list' ? z.array(z.string()) : z.string()
    shape[key] = sectionSchema
  }
  return z.object(shape)
}

export function buildInsightJsonSchema(template: InsightTemplateLike): object {
  const properties: Record<string, object> = {}
  const required: string[] = []
  for (const section of template.sections) {
    const key = slugifyKey(section.title)
    required.push(key)
    properties[key] =
      section.type === 'list' ? { type: 'array', items: { type: 'string' } } : { type: 'string' }
  }
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  }
}
