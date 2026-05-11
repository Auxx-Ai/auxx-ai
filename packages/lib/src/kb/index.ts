// export * from './kb-service'

export {
  DRAFT_SECTION_FIELDS,
  type DraftSection,
  draftedSections,
  hasUnpublishedSettings,
  type KBDraftSettings,
  mergeDraftOverLive,
} from './draft-settings'
export {
  enrichDocWithHighlighting,
  SHIKI_LANGUAGES,
  type ShikiLanguage,
} from './highlight-code'
export {
  type ArticleBatchUpdateItem,
  type ArticleCreateInput,
  type ArticleListOptions,
  type KBCreateInput,
  type KBFields,
  type KBLiveInput,
  KBService,
  type KBUpdateInput,
} from './kb-service'
export { enqueueKBSync, type KBSyncJobData, type KBSyncJobType } from './kb-sync-queue'
export { KBSyncService } from './kb-sync-service'
export {
  captureKopilotSnapshot,
  clearKopilotSnapshot,
  type KopilotPreTurnSnapshot,
  readKopilotSnapshot,
} from './kopilot-snapshot'
export { articleToMarkdown } from './markdown/article-to-markdown'
export { type KbArticleEvent, kbArticleChannel, publishKbArticleEvent } from './realtime'
