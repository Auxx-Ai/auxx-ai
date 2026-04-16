// packages/lib/src/recording/ai/index.ts

export { generateChapters } from './chapter-generator'
export { runDefaultInsights, runInsightTemplate } from './insight-runner'
export { runAIPostProcess } from './post-process'
export {
  createInsightTemplate,
  getInsightDetail,
  listChapters,
  listInsights,
  listInsightTemplates,
} from './queries'
export { resolveRecordingLLM } from './resolve-llm'
export { generateSummary } from './summary-generator'
export type {
  ActionItem,
  GeneratedChapter,
  GeneratedSummary,
  InsightSectionResult,
  InsightTemplateSection,
  PostProcessScope,
} from './types'
