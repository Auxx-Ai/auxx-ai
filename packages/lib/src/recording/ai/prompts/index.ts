// packages/lib/src/recording/ai/prompts/index.ts

export {
  buildChapterSystemPrompt,
  buildChapterUserPrompt,
  CHAPTER_JSON_SCHEMA,
  type ChapterContext,
  type ChapterResponse,
  ChapterResponseSchema,
} from './chapter-prompt'
export {
  buildInsightJsonSchema,
  buildInsightResponseSchema,
  buildInsightSystemPrompt,
  buildInsightUserPrompt,
  type InsightTemplateLike,
  slugifyKey,
} from './insight-prompt'
export {
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  SUMMARY_JSON_SCHEMA,
  type SummaryContext,
  type SummaryResponse,
  SummaryResponseSchema,
} from './summary-prompt'
