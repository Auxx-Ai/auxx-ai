// @auxx/lib/kb/types.ts
import type { Database, Transaction } from '@auxx/database'
import type {
  ArticleKind as ArticleKindType,
  ArticleStatus as ArticleStatusType,
} from '@auxx/database/types'
import type { RecordId } from '@auxx/types/resource'
import type { ArticleNodeJSON } from './markdown/types'

export type KBPublishStatus = 'DRAFT' | 'PUBLISHED' | 'UNLISTED'

/**
 * Shared context passed into every kb function. `db` is optional — when
 * omitted, functions fall back to the singleton `database` export. Pass a
 * `Transaction` here to participate in an existing tx.
 */
export interface KBContext {
  db?: Database | Transaction
  organizationId: string
  userId?: string
}

// ─── Public shapes (flattened) ───────────────────────────────────────────

/**
 * Lightweight metadata for a single revision (draft or published).
 * Keeps cover URLs resolved server-side so consumers don't need a follow-up
 * roundtrip per id.
 */
export interface ArticleRevisionMeta {
  title: string
  description: string | null
  excerpt: string | null
  emoji: string | null
  coverImage: string | null
  coverImageId: string | null
}

export interface ArticleListItem {
  id: string
  knowledgeBaseId: string
  organizationId: string
  slug: string
  parentId: string | null
  sortOrder: string
  articleKind: ArticleKindType
  isPublished: boolean
  aiEnabled: boolean
  status: ArticleStatusType
  hasUnpublishedChanges: boolean
  publishedAt: Date | null
  publishedRevisionId: string | null
  draftRevisionId: string | null
  // Display fields — derived from the draft revision (current working state).
  title: string
  emoji: string | null
  description: string | null
  excerpt: string | null
  coverImage: string | null
  /**
   * Per-revision envelopes so consumers (editor, preview) can read the
   * exact revision they need without an extra async fetch. `draft` is
   * always present (every article has a draft); `published` is null
   * until the article has been published at least once.
   */
  draft: ArticleRevisionMeta
  published: ArticleRevisionMeta | null
  /** Tag RecordIds (`entityDefinitionId:tagId`) attached to this article. */
  tagIds: RecordId[]
}

export interface ArticleEditorView extends ArticleListItem {
  // Always the draft fields, plus the heavy content
  content: string
  contentJson: ArticleNodeJSON[] | null
  /** Hash of `contentJson` — the editor uses it to dedupe inbound syncs. */
  draftContentHash: string
  coverImageId: string | null
  hasPublishedVersion: boolean
  publishedTitle: string | null
  publishedContent: string | null
  publishedContentJson: ArticleNodeJSON[] | null
  publishedCoverImage: string | null
  // Populated only when getArticleById is called with a versionNumber.
  selectedVersionNumber: number | null
  selectedTitle: string | null
  selectedDescription: string | null
  selectedExcerpt: string | null
  selectedEmoji: string | null
  selectedContent: string | null
  selectedContentJson: ArticleNodeJSON[] | null
  selectedContentHash: string | null
  selectedCoverImage: string | null
  selectedCoverImageId: string | null
}

// ─── KB / Article input shapes ───────────────────────────────────────────

export interface KBFields {
  name?: string
  slug?: string
  description?: string
  publishStatus?: KBPublishStatus
  visibility?: 'PUBLIC' | 'INTERNAL'
  customDomain?: string
  logoDark?: string
  logoLight?: string
  theme?: 'clean' | 'muted' | 'gradient' | 'bold'
  showMode?: boolean
  defaultMode?: 'light' | 'dark'
  primaryColorLight?: string
  primaryColorDark?: string
  tintColorLight?: string
  tintColorDark?: string
  infoColorLight?: string
  infoColorDark?: string
  successColorLight?: string
  successColorDark?: string
  warningColorLight?: string
  warningColorDark?: string
  dangerColorLight?: string
  dangerColorDark?: string
  fontFamily?: string
  iconsFamily?: 'solid' | 'regular' | 'light'
  cornerStyle?: 'rounded' | 'straight'
  sidebarListStyle?: 'default' | 'pill' | 'line'
  searchbarPosition?: 'center' | 'corner'
  headerEnabled?: boolean
  footerEnabled?: boolean
  headerNavigation?: Array<{ title: string; link: string }>
  footerNavigation?: Array<{ title: string; link: string }>
}

export interface KBCreateInput
  extends Required<Pick<KBFields, 'name' | 'slug'>>,
    Omit<KBFields, 'name' | 'slug'> {}

/**
 * Live-only update input. Settings that visitors care about (theme, colors,
 * navigation, etc.) live in the draft envelope and go through
 * {@link updateDraftSettings}.
 */
export interface KBLiveInput {
  slug?: string
  customDomain?: string | null
  visibility?: 'PUBLIC' | 'INTERNAL'
  publishStatus?: KBPublishStatus
}

export type KBUpdateInput = KBLiveInput

export interface ArticleCreateInput {
  title?: string
  description?: string | null
  slug?: string
  content?: string
  contentJson?: ArticleNodeJSON[] | null
  excerpt?: string | null
  emoji?: string | null
  coverImageId?: string | null
  articleKind?: ArticleKindType
  parentId?: string | null
}

export interface ArticleDraftFields {
  title?: string
  description?: string | null
  excerpt?: string | null
  emoji?: string | null
  content?: string
  contentJson?: ArticleNodeJSON[] | null
  coverImageId?: string | null
}

export interface ArticleStructureFields {
  slug?: string
  parentId?: string | null
  aiEnabled?: boolean
}

export interface MoveArticleInput {
  id: string
  parentId: string | null
  sortOrder?: string
  adjacentId?: string
  position?: 'before' | 'after'
}

export interface ArticleBatchUpdateItem {
  id: string
  updates: ArticleDraftFields & ArticleStructureFields
}

export interface ArticleListOptions {
  includeUnpublished?: boolean
}
