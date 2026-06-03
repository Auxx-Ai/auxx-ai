// apps/web/src/components/kb/ui/articles/articles-view.tsx
//
// Articles table at /app/kb — composes DynamicResourceView with a non-removable
// baseline filter, article-specific primary cell + dropdown, a tags-only
// cellSelection, and the shared records search bar.
//
// tableId is intentionally `resource-article` (not `entity-<id>`) so that
// saved-view state doesn't collide with a hypothetical RecordsView mounted
// with slug='article'.
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { converters } from '@auxx/lib/field-values/client'
import type { RecordId, ResourceField } from '@auxx/lib/resources/client'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Archive, FileText, Globe, GlobeLock, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useRef } from 'react'
import type { CellSelectionConfig } from '~/components/dynamic-table'
import { PrimaryFieldCell } from '~/components/dynamic-table'
import {
  DynamicResourceView,
  type DynamicResourceViewHandle,
} from '~/components/dynamic-table/dynamic-resource-view'
import type { ExtendedColumnDef } from '~/components/dynamic-table/types'
import { decodeColumnId } from '~/components/dynamic-table/utils/column-id'
import { FavoriteToggleMenuItem } from '~/components/favorites/ui/favorite-toggle-menu-item'
import { EmptyState } from '~/components/global/empty-state'
import {
  searchConditionsToGroup,
  useRecordsSearchStore,
} from '~/components/records/records-search-store'
import { RecordsSearchBar } from '~/components/records/records-searchbar'
import { type RecordMeta, toRecordId, useResource } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useRelationshipStore } from '~/components/resources/store/relationship-store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/** The resource slug + (system) tableId for articles. */
const ARTICLE_SLUG = 'article'
const ARTICLE_TABLE_ID = 'resource-article'

/** The single inline-editable column on the articles table. */
const TAGS_COLUMN_ID = toResourceFieldId(ARTICLE_SLUG, toFieldId('tags'))

/**
 * Row shape returned by the picker hydrator. Picker spreads the full Article
 * row into RecordMeta, so kb id / slug / publish state are top-level.
 */
interface ArticleRow extends RecordMeta {
  slug?: string
  knowledgeBaseId?: string
  isPublished?: boolean
  articleKind?: string
}

/**
 * Baseline (non-removable) filter:
 *   - kind ∈ {page, category}
 *   - archivedAt IS NULL
 *
 * Defined at module scope so the reference stays stable across renders;
 * useRecordList keys its cache off this object, so a fresh literal each
 * render would refetch on every mount.
 */
const ARTICLES_BASELINE_FILTER: ConditionGroup = {
  id: 'articles-baseline',
  logicalOperator: 'AND',
  conditions: [
    {
      id: 'articles-baseline-kind',
      fieldId: toResourceFieldId(ARTICLE_SLUG, toFieldId('kind')),
      operator: 'in',
      value: ['page', 'category'],
    },
    {
      id: 'articles-baseline-archivedAt',
      fieldId: toResourceFieldId(ARTICLE_SLUG, toFieldId('archivedAt')),
      operator: 'empty',
      value: null,
    },
  ],
}

/** Fields hidden by default. Other fields fall back to the registry's showInPanel. */
const HIDDEN_BY_DEFAULT = new Set<string>(['parent', 'publishedAt', 'createdAt', 'excerpt', 'kind'])

export function ArticlesView() {
  const router = useRouter()
  const viewRef = useRef<DynamicResourceViewHandle | null>(null)
  const fieldMap = useResourceStore((state) => state.fieldMap)
  const { saveBulkMultipleFields } = useSaveFieldValue()
  const utils = api.useUtils()
  const { resource } = useResource(ARTICLE_SLUG)

  // Search-bar conditions are shared with RecordsView's search store; the
  // store auto-resets via setContext(entityDefinitionId) on mount, so
  // switching between pages clears stale filters.
  const searchConditions = useRecordsSearchStore((s) => s.conditions)
  const searchGroup = useMemo(() => searchConditionsToGroup(searchConditions), [searchConditions])

  // ARTICLES_BASELINE_FILTER pins kind/archivedAt; the searchGroup adds
  // user filters. Both are AND, so we flatten their conditions into one
  // group (ConditionGroup.conditions is Condition[], not nested groups).
  const baselineFilter = useMemo<ConditionGroup>(() => {
    if (!searchGroup) return ARTICLES_BASELINE_FILTER
    return {
      id: 'articles-baseline-with-search',
      logicalOperator: 'AND',
      conditions: [...ARTICLES_BASELINE_FILTER.conditions, ...searchGroup.conditions],
    }
  }, [searchGroup])

  const [confirm, ConfirmDialog] = useConfirm()

  const refresh = useCallback(() => viewRef.current?.refresh(), [])

  const invalidateArticle = useCallback(
    async (knowledgeBaseId: string | undefined) => {
      await Promise.all([
        utils.kb.getArticles.invalidate(knowledgeBaseId ? { knowledgeBaseId } : undefined),
        utils.kb.list.invalidate(),
      ])
      refresh()
    },
    [utils, refresh]
  )

  const publishArticle = api.kb.publishArticle.useMutation({
    onSuccess: (_, vars) => invalidateArticle(vars.knowledgeBaseId),
    onError: (e) => toastError({ title: 'Could not publish article', description: e.message }),
  })
  const unpublishArticle = api.kb.unpublishArticle.useMutation({
    onSuccess: (_, vars) => invalidateArticle(vars.knowledgeBaseId),
    onError: (e) => toastError({ title: 'Could not unpublish article', description: e.message }),
  })
  const archiveArticle = api.kb.archiveArticle.useMutation({
    onSuccess: (_, vars) => invalidateArticle(vars.knowledgeBaseId),
    onError: (e) => toastError({ title: 'Could not archive article', description: e.message }),
  })
  const deleteArticle = api.kb.deleteArticle.useMutation({
    onSuccess: (_, vars) => invalidateArticle(vars.knowledgeBaseId),
    onError: (e) => toastError({ title: 'Could not delete article', description: e.message }),
  })

  const handlePublishToggle = useCallback(
    (row: ArticleRow) => {
      const input = { id: row.id, knowledgeBaseId: row.knowledgeBaseId }
      if (row.isPublished) {
        unpublishArticle.mutate(input)
      } else {
        publishArticle.mutate({ ...input, ancestorIds: [] })
      }
    },
    [publishArticle, unpublishArticle]
  )

  const handleArchive = useCallback(
    async (row: ArticleRow) => {
      const ok = await confirm({
        title: 'Archive article?',
        description: 'Archived articles are hidden from this list but not deleted.',
        confirmText: 'Archive',
        destructive: true,
      })
      if (!ok) return
      archiveArticle.mutate({ id: row.id, knowledgeBaseId: row.knowledgeBaseId })
    },
    [archiveArticle, confirm]
  )

  const handleDelete = useCallback(
    async (row: ArticleRow) => {
      if (!row.knowledgeBaseId) return
      const ok = await confirm({
        title: 'Delete article?',
        description: 'This action cannot be undone.',
        confirmText: 'Delete',
        destructive: true,
      })
      if (!ok) return
      deleteArticle.mutate({ id: row.id, knowledgeBaseId: row.knowledgeBaseId })
    },
    [deleteArticle, confirm]
  )

  // Primary cell: title + dropdown. Title click navigates to the editor.
  const primaryCellRender = useCallback(
    (row: ArticleRow) => {
      const resourceFieldId = toResourceFieldId(ARTICLE_SLUG, toFieldId('title'))
      const canOpenEditor = !!row.knowledgeBaseId && !!row.slug
      return (
        <PrimaryFieldCell
          resourceFieldId={resourceFieldId}
          rowId={row.id}
          onTitleClick={() => {
            if (!canOpenEditor) return
            router.push(`/app/kb/${row.knowledgeBaseId}/editor/${row.slug}`)
          }}>
          {row.knowledgeBaseId &&
            (row.articleKind === 'page' || row.articleKind === 'category') && (
              <FavoriteToggleMenuItem
                targetType='ARTICLE'
                targetIds={{ articleId: row.id, knowledgeBaseId: row.knowledgeBaseId }}
              />
            )}
          <DropdownMenuItem onSelect={() => handlePublishToggle(row)}>
            {row.isPublished ? <GlobeLock /> : <Globe />}
            {row.isPublished ? 'Unpublish' : 'Publish'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleArchive(row)}>
            <Archive />
            Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onSelect={() => handleDelete(row)}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </PrimaryFieldCell>
      )
    },
    [router, handlePublishToggle, handleArchive, handleDelete]
  )

  // Hide non-default scalar columns; KB is registered as a system resource,
  // so the generic CustomFieldCell renders `knowledgeBase` as a RecordBadge.
  const columnOverrides = useCallback(
    (field: ResourceField & { id: string }): Partial<ExtendedColumnDef<ArticleRow>> | undefined => {
      return HIDDEN_BY_DEFAULT.has(field.key) ? { defaultVisible: false } : undefined
    },
    []
  )

  const renderSearchBar = useCallback(
    () =>
      resource ? (
        <RecordsSearchBar entityDefinitionId={resource.id} fields={resource.fields} />
      ) : null,
    [resource]
  )

  // Tags-only cellSelection. Mirrors the records-view config but only the
  // `tags` column is writable; everything else falls through as skipped.
  const cellSelectionConfig: CellSelectionConfig = useMemo(() => {
    const isTagsColumn = (columnId: string) => columnId === TAGS_COLUMN_ID

    const resolveField = (columnId: string): ResourceField | null => {
      if (columnId.startsWith('_')) return null
      const decoded = decodeColumnId(columnId)
      if (decoded.type === 'path') {
        const last = decoded.fieldPath[decoded.fieldPath.length - 1]
        return fieldMap[last] ?? null
      }
      return fieldMap[decoded.resourceFieldId] ?? null
    }

    const readValue = (recordId: RecordId, columnId: string) =>
      viewRef.current?.getValue(recordId, columnId)

    return {
      enabled: true,
      getFieldDefinition: resolveField,
      getCellValue: (rowId, columnId) => {
        if (columnId.startsWith('_')) return undefined
        return readValue(toRecordId(ARTICLE_SLUG, rowId), columnId)
      },
      getRecordId: (rowId) => toRecordId(ARTICLE_SLUG, rowId),
      formatCellForCopy: (rowId, columnId) => {
        if (columnId.startsWith('_')) return null
        const field = resolveField(columnId)
        if (!field?.fieldType) return null
        const raw = readValue(toRecordId(ARTICLE_SLUG, rowId), columnId)
        if (raw === null || raw === undefined) return { display: '', fieldType: field.fieldType }
        const converter = converters[field.fieldType]
        if (!converter) return { display: String(raw ?? ''), fieldType: field.fieldType }

        if (field.fieldType === 'RELATIONSHIP') {
          const dataMap = useRelationshipStore.getState().dataMap
          const resolve = (v: unknown) => {
            const rid = converter.toRawValue(v) as string | null
            if (!rid) return { recordId: null as string | null, display: '' }
            const item = dataMap[rid as RecordId]
            return { recordId: rid, display: item?.displayName ?? rid }
          }
          if (Array.isArray(raw)) {
            const resolved = raw.map(resolve).filter((r) => r.recordId !== null)
            const displays = resolved.map((r) => r.display)
            const joined = displays.join(', ')
            return {
              display: joined,
              raw: resolved.map((r) => r.recordId as string),
              fieldType: field.fieldType,
              primaryDisplay: joined,
            }
          }
          const { recordId, display } = resolve(raw)
          if (!recordId) return { display: '', fieldType: field.fieldType }
          return {
            display,
            raw: recordId,
            fieldType: field.fieldType,
            recordId,
            primaryDisplay: display,
          }
        }

        if (Array.isArray(raw)) {
          const displays = raw
            .map((v) => String(converter.toDisplayValue(v, field.options) ?? ''))
            .filter(Boolean)
          return {
            display: displays.join(', '),
            raw: raw.map((v) => converter.toRawValue(v)),
            fieldType: field.fieldType,
          }
        }
        return {
          display: String(converter.toDisplayValue(raw, field.options) ?? ''),
          raw: converter.toRawValue(raw),
          fieldType: field.fieldType,
        }
      },
      resolveRelationshipByDisplay: (columnId, query) => {
        const field = resolveField(columnId)
        if (!field) return null
        const targetDefId = field.options?.relationship?.relatedEntityDefinitionId
        if (!targetDefId) return null
        const q = query.trim().toLowerCase()
        if (!q) return null
        const dataMap = useRelationshipStore.getState().dataMap
        for (const [recordId, item] of Object.entries(dataMap)) {
          if (!item) continue
          if (!recordId.startsWith(`${targetDefId}:`)) continue
          if (item.displayName.toLowerCase() === q) return recordId
        }
        return null
      },
      resolveActorByDisplay: () => null,
      clearCells: async (cells) => {
        const writable = cells.filter((c) => isTagsColumn(c.columnId))
        const skipped = cells.length - writable.length
        if (writable.length === 0) return { skipped }

        const rowIds = new Set(writable.map((c) => c.rowId))
        const tagsField = fieldMap[TAGS_COLUMN_ID]
        if (!tagsField?.fieldType) return { skipped: cells.length }
        saveBulkMultipleFields(
          Array.from(rowIds).map((id) => toRecordId(ARTICLE_SLUG, id)),
          [{ fieldId: TAGS_COLUMN_ID, value: null, fieldType: tagsField.fieldType }]
        )
        return { skipped }
      },
      saveCells: async (updates) => {
        const writable = updates.filter((u) => isTagsColumn(u.columnId))
        const skipped = updates.length - writable.length
        if (writable.length === 0) return { skipped }

        const tagsField = fieldMap[TAGS_COLUMN_ID]
        if (!tagsField?.fieldType) return { skipped: updates.length }

        // Group rows whose new tags value matches so we send one bulk write per
        // distinct value bucket.
        const buckets = new Map<string, { recordIds: RecordId[]; value: unknown }>()
        for (const u of writable) {
          const sig = JSON.stringify(u.value)
          let bucket = buckets.get(sig)
          if (!bucket) {
            bucket = { recordIds: [], value: u.value }
            buckets.set(sig, bucket)
          }
          bucket.recordIds.push(toRecordId(ARTICLE_SLUG, u.rowId))
        }

        for (const { recordIds, value } of buckets.values()) {
          saveBulkMultipleFields(recordIds, [
            { fieldId: TAGS_COLUMN_ID, value, fieldType: tagsField.fieldType },
          ])
        }
        return { skipped }
      },
      isAiField: () => false,
      saveAiCells: async () => ({ skipped: 0 }),
    }
  }, [fieldMap, saveBulkMultipleFields])

  const emptyState = useMemo(
    () => (
      <div className='flex h-full items-center justify-center'>
        <EmptyState
          icon={FileText}
          title='No articles yet'
          description='Open a knowledge base to create your first article.'
        />
      </div>
    ),
    []
  )

  // Chrome (MainPage header, breadcrumb + KB switcher, the Create-KB action) is
  // owned by KBLandingShell — this view is just the Articles table now.
  return (
    <>
      <DynamicResourceView<ArticleRow>
        viewRef={viewRef}
        embedded
        slug={ARTICLE_SLUG}
        tableId={ARTICLE_TABLE_ID}
        baselineFilter={baselineFilter}
        primaryCellRender={primaryCellRender}
        columnOverrides={columnOverrides}
        cellSelection={cellSelectionConfig}
        bulkActions={[]}
        renderSearchBar={renderSearchBar}
        emptyState={emptyState}
      />
      <ConfirmDialog />
    </>
  )
}
