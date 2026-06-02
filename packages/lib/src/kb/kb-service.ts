// @auxx/lib/kb/kb-service.ts
//
// Thin compatibility shim that delegates to the per-concern modules in
// ./articles and ./knowledge-base. New code should call those functions
// directly; this class exists so existing callers (the kb router, the
// kopilot capability tools, the seeder, kb-sync-service) keep working.

import type { Database } from '@auxx/database'
import { archiveArticle, unarchiveArticle } from './articles/archive-article'
import {
  getArticleDiff,
  getArticleVersions,
  renameArticleVersion,
  restoreArticleVersion,
} from './articles/article-versions'
import { createArticle } from './articles/create-article'
import { deleteArticle } from './articles/delete-article'
import { discardArticleDraft } from './articles/discard-article-draft'
import { getArticleById, getArticleBySlug, getArticleSlugPath } from './articles/get-article'
import { getAllArticles, getArticles } from './articles/list-articles'
import { moveArticle } from './articles/move-article'
import { publishArticle, unpublishArticle } from './articles/publish-article'
import {
  updateArticleDraft,
  updateArticleStructure,
  updateArticlesBatch,
} from './articles/update-article'
import type { KBDraftSettings } from './draft-settings'
import { createKnowledgeBase, ensureManagedDataset } from './knowledge-base/create-knowledge-base'
import { deleteKnowledgeBase } from './knowledge-base/delete-knowledge-base'
import {
  discardSettingsDraft,
  publishPendingSettings,
  updateDraftSettings,
} from './knowledge-base/draft-settings-ops'
import { getKnowledgeBaseById, listKnowledgeBases } from './knowledge-base/get-knowledge-base'
import {
  publishKnowledgeBase,
  unpublishKnowledgeBase,
} from './knowledge-base/publish-knowledge-base'
import { updateKnowledgeBase } from './knowledge-base/update-knowledge-base'
import type {
  ArticleBatchUpdateItem,
  ArticleCreateInput,
  ArticleDraftFields,
  ArticleListOptions,
  ArticleStructureFields,
  KBContext,
  KBCreateInput,
  KBLiveInput,
  MoveArticleInput,
} from './types'

export class KBService {
  private readonly ctx: KBContext

  constructor(db: Database, organizationId: string) {
    this.ctx = { db, organizationId }
  }

  // ─── KB CRUD ────────────────────────────────────────────────────────

  getKnowledgeBaseById(id: string) {
    return getKnowledgeBaseById(this.ctx, id)
  }
  listKnowledgeBases() {
    return listKnowledgeBases(this.ctx)
  }
  createKnowledgeBase(input: KBCreateInput, createdById: string) {
    return createKnowledgeBase(this.ctx, input, createdById)
  }
  ensureManagedDataset(kb: Parameters<typeof ensureManagedDataset>[1], createdById: string) {
    return ensureManagedDataset(this.ctx, kb, createdById)
  }
  updateKnowledgeBase(id: string, data: KBLiveInput) {
    return updateKnowledgeBase(this.ctx, id, data)
  }
  updateDraftSettings(id: string, patch: KBDraftSettings) {
    return updateDraftSettings(this.ctx, id, patch)
  }
  publishPendingSettings(id: string) {
    return publishPendingSettings(this.ctx, id)
  }
  discardSettingsDraft(id: string) {
    return discardSettingsDraft(this.ctx, id)
  }
  deleteKnowledgeBase(id: string) {
    return deleteKnowledgeBase(this.ctx, id)
  }
  publishKnowledgeBase(id: string, status: 'PUBLISHED' | 'UNLISTED') {
    return publishKnowledgeBase(this.ctx, id, status)
  }
  unpublishKnowledgeBase(id: string) {
    return unpublishKnowledgeBase(this.ctx, id)
  }

  // ─── Article reads ──────────────────────────────────────────────────

  getArticles(knowledgeBaseId: string, options: ArticleListOptions = {}) {
    return getArticles(this.ctx, knowledgeBaseId, options)
  }
  getAllArticles(options: ArticleListOptions = {}) {
    return getAllArticles(this.ctx, options)
  }
  getArticleById(id: string, knowledgeBaseId?: string, versionNumber?: number) {
    return getArticleById(this.ctx, id, knowledgeBaseId, versionNumber)
  }
  getArticleBySlug(slug: string, knowledgeBaseId: string) {
    return getArticleBySlug(this.ctx, slug, knowledgeBaseId)
  }
  getArticleSlugPath(articleId: string) {
    return getArticleSlugPath(this.ctx, articleId)
  }

  // ─── Article writes ─────────────────────────────────────────────────

  createArticle(
    knowledgeBaseId: string,
    input: ArticleCreateInput,
    authorId: string,
    orderInfo?: { adjacentId: string; position: 'before' | 'after' }
  ) {
    return createArticle(this.ctx, knowledgeBaseId, input, authorId, orderInfo)
  }
  updateArticleDraft(
    id: string,
    fields: ArticleDraftFields,
    editorId: string,
    knowledgeBaseId?: string,
    options: {
      bypassSnapshotClear?: boolean
      suppressResyncEvent?: boolean
      originatorSessionId?: string
    } = {}
  ) {
    return updateArticleDraft(this.ctx, id, fields, editorId, knowledgeBaseId, options)
  }
  updateArticleStructure(id: string, fields: ArticleStructureFields, knowledgeBaseId?: string) {
    return updateArticleStructure(this.ctx, id, fields, knowledgeBaseId)
  }
  updateArticlesBatch(knowledgeBaseId: string, articles: ArticleBatchUpdateItem[]) {
    return updateArticlesBatch(this.ctx, knowledgeBaseId, articles)
  }
  deleteArticle(id: string, knowledgeBaseId?: string) {
    return deleteArticle(this.ctx, id, knowledgeBaseId)
  }

  // ─── Publish state transitions ──────────────────────────────────────

  publishArticle(id: string, editorId: string, ancestorIds: string[] = []) {
    return publishArticle(this.ctx, id, editorId, ancestorIds)
  }
  unpublishArticle(id: string) {
    return unpublishArticle(this.ctx, id)
  }
  archiveArticle(id: string) {
    return archiveArticle(this.ctx, id)
  }
  unarchiveArticle(id: string) {
    return unarchiveArticle(this.ctx, id)
  }
  discardArticleDraft(id: string) {
    return discardArticleDraft(this.ctx, id)
  }
  restoreArticleVersion(versionId: string, editorId: string) {
    return restoreArticleVersion(this.ctx, versionId, editorId)
  }
  moveArticle(knowledgeBaseId: string, input: MoveArticleInput) {
    return moveArticle(this.ctx, knowledgeBaseId, input)
  }

  // ─── Versions ───────────────────────────────────────────────────────

  getArticleVersions(articleId: string) {
    return getArticleVersions(this.ctx, articleId)
  }
  getArticleDiff(articleId: string, base: string, compare: string) {
    return getArticleDiff(this.ctx, articleId, base, compare)
  }
  renameArticleVersion(versionId: string, label: string | null) {
    return renameArticleVersion(this.ctx, versionId, label)
  }
}
