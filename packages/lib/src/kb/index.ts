// export * from './kb-service'

export {
  enrichDocWithHighlighting,
  SHIKI_LANGUAGES,
  type ShikiLanguage,
} from './highlight-code'
export {
  type ArticleBaseFields,
  type ArticleBatchUpdateItem,
  type ArticleCreateInput,
  type ArticleIncludeOptions,
  type ArticleListOptions,
  type ArticleUpdateInput,
  type KBCreateInput,
  type KBFields,
  KBService,
  type KBUpdateInput,
} from './kb-service'
