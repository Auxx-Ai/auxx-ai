// @auxx/lib/kb/index.ts

export { archiveArticle, unarchiveArticle } from './articles/archive-article'
export {
  getArticleVersions,
  renameArticleVersion,
  restoreArticleVersion,
} from './articles/article-versions'
export { createArticle } from './articles/create-article'
export { deleteArticle } from './articles/delete-article'
export { discardArticleDraft } from './articles/discard-article-draft'
export {
  getArticleById,
  getArticleBySlug,
  getArticleSlugPath,
} from './articles/get-article'
export { getAllArticles, getArticles } from './articles/list-articles'
export { moveArticle } from './articles/move-article'
export { publishArticle, unpublishArticle } from './articles/publish-article'
export {
  updateArticleDraft,
  updateArticleStructure,
  updateArticlesBatch,
} from './articles/update-article'
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
export { KBService } from './kb-service'
export { enqueueKBSync, type KBSyncJobData, type KBSyncJobType } from './kb-sync-queue'
export { KBSyncService } from './kb-sync-service'
export {
  createKnowledgeBase,
  ensureManagedDataset,
} from './knowledge-base/create-knowledge-base'
export { deleteKnowledgeBase } from './knowledge-base/delete-knowledge-base'
export {
  discardSettingsDraft,
  publishPendingSettings,
  updateDraftSettings,
} from './knowledge-base/draft-settings-ops'
export {
  getKnowledgeBaseById,
  listKnowledgeBases,
} from './knowledge-base/get-knowledge-base'
export {
  publishKnowledgeBase,
  unpublishKnowledgeBase,
} from './knowledge-base/publish-knowledge-base'
export { updateKnowledgeBase } from './knowledge-base/update-knowledge-base'
export {
  captureKopilotSnapshot,
  clearKopilotSnapshot,
  type KopilotPreTurnSnapshot,
  readKopilotSnapshot,
} from './kopilot-snapshot'
export { articleToMarkdown } from './markdown/article-to-markdown'
export { type KbArticleEvent, kbArticleChannel, publishKbArticleEvent } from './realtime'
export { type RenderArticleOptions, renderArticleHtml } from './render-article-html'
export { syncArticleDenormalizedFields } from './sync-article-denormalized-fields'
export type {
  ArticleBatchUpdateItem,
  ArticleCreateInput,
  ArticleDraftFields,
  ArticleEditorView,
  ArticleListItem,
  ArticleListOptions,
  ArticleRevisionMeta,
  ArticleStructureFields,
  KBContext,
  KBCreateInput,
  KBFields,
  KBLiveInput,
  KBPublishStatus,
  KBUpdateInput,
  MoveArticleInput,
} from './types'
