// apps/web/src/components/kb/store/index.ts

export {
  type ArticleMeta,
  type ArticleTreeNode,
  getArticleStoreState,
  selectArticlesForKb,
  selectEffectiveArticle,
  useArticleStore,
} from './article-store'
export {
  getKnowledgeBaseStoreState,
  type KnowledgeBase,
  selectEffectiveKnowledgeBase,
  selectEffectiveKnowledgeBases,
  useKnowledgeBaseStore,
} from './knowledge-base-store'
