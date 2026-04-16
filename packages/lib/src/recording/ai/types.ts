// packages/lib/src/recording/ai/types.ts

import type { ActionItem } from '@auxx/database'

export type { ActionItem }

export type GeneratedSummary = {
  summaryText: string
  actionItems: ActionItem[]
}

export type GeneratedChapter = {
  title: string
  startMs: number
  endMs: number
}

export type InsightSectionResult = {
  templateSectionId: string
  title: string
  type: 'plaintext' | 'list'
  values: string[]
}

export type InsightTemplateSection = {
  id?: string
  title: string
  prompt: string
  type: 'plaintext' | 'list'
  sortOrder: number
}

export type PostProcessScope = 'all' | 'summary' | 'chapters' | 'insights'
