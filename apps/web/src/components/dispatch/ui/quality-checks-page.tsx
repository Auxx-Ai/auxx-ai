// apps/web/src/components/dispatch/ui/quality-checks-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Lock, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import type { QcItemTemplateRow } from '~/components/dispatch/ui/quality-check-tree-row'
import { QualityCheckTreeRow } from '~/components/dispatch/ui/quality-check-tree-row'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import SettingsPage from '~/components/global/settings-page'
import { BaseType } from '~/components/workflow/types'
import { useConfirm } from '~/hooks/use-confirm'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { useMedia } from '~/hooks/use-media'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

const BREADCRUMBS = [{ title: 'Dispatch Settings' }, { title: 'Quality Checks' }]

/**
 * A phantom QC template (plans/dispatch/15-settings-phantom-editors.md Phase 3): exists only in
 * local state until its first committed edit. Only one draft can exist at a time — clicking
 * "Add check" again, selecting a different row, or navigating away while it's untouched drops it
 * silently (nothing was ever persisted).
 */
interface QcDraft {
  draftId: string
  title: string
  description: string
  isRequired: boolean
  /**
   * Set once the draft's first `createQcTemplate` resolves. The draft is KEPT alive after
   * creation (with selection swapped to this id) so the draft editor stays mounted — remounting
   * onto the template-bound editor mid-typing would replace the input's text with the create
   * snapshot and cancel the pending debounced title/description commit (`useDebouncedCallback`
   * clears its timer on unmount; the trap `CatalogDraftHandle.recordId` documents). The list
   * hides the phantom row once this is set (the real row arrived via the cache append); the
   * draft is finally dropped when the user navigates to another row.
   */
  recordId?: string
}

function freshQcDraft(draftId: string): QcDraft {
  return { draftId, title: '', description: '', isRequired: false }
}

/**
 * Dispatch Quality Checks settings page (plans/dispatch/08-worker-surface.md §5): the
 * admin-managed catalog of QC item templates a worker's per-visit checklist is materialized from.
 * Master-detail mirroring the Products & Services page — a sortable `TreeRow` list on the left
 * (trailing delete button + active `Switch`; deleting a template never touches already-
 * materialized visit checklists) and a per-field autosaving `FieldPanel` editor on the right (a
 * `DockableDrawer` below `lg`). Create/toggle/edit/delete all update the cached list
 * optimistically or on success, reconciling from the server only on error.
 *
 * "Add check" is phantom-until-first-edit: it renders a local draft row + editor instantly (no
 * network) and only fires `createQcTemplate` on the draft's first real commit.
 */
export function QualityChecksPage() {
  useUser({ requireRoles: ['ADMIN', 'OWNER'] })
  const { hasAccess } = useFeatureFlags()

  const utils = api.useUtils()
  const templatesQuery = api.dispatch.listQcTemplates.useQuery()
  const templates = templatesQuery.data ?? []

  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Optimistic reordered view — set on drag end, cleared once the batch mutation settles
  // (whether it succeeds or fails; the settled invalidate reseeds from the server either way).
  const [orderOverride, setOrderOverride] = useState<QcItemTemplateRow[] | null>(null)
  const orderedTemplates = orderOverride ?? templates

  // Phantom draft state. `draftRef` mirrors `draft` so `commitDraft`'s post-await continuation
  // always reads the live value instead of a stale closure (the line-builder recipe,
  // line-builder.tsx:154-156). `creatingDraftIdRef` is the synchronous double-create guard:
  // commits that land while that draft's first create is still in flight merge into local state
  // instead of firing a second create. `createdIdRef` mirrors the CURRENT draft's `recordId` —
  // flipped synchronously (before any state lands) so a commit racing the create's success
  // callback routes straight to `patchTemplate` instead of buffering (product-editor.tsx's
  // `recordIdRef` recipe; reset whenever the draft handle is dropped or replaced).
  const [draft, setDraft] = useState<QcDraft | null>(null)
  const draftRef = useRef<QcDraft | null>(null)
  draftRef.current = draft
  const creatingDraftIdRef = useRef<string | null>(null)
  const createdIdRef = useRef<string | null>(null)

  const isDesktop = useMedia('(min-width: 1024px)')
  const [confirm, ConfirmDialog] = useConfirm()

  const invalidate = () => utils.dispatch.listQcTemplates.invalidate()

  /** Optimistically merge a partial patch into the cached list (used by the toggle + editor). */
  const patchCached = (id: string, patch: Partial<QcItemTemplateRow>) => {
    utils.dispatch.listQcTemplates.setData(undefined, (old) =>
      old?.map((t) => (t.id === id ? { ...t, ...patch } : t))
    )
  }

  const createTemplate = api.dispatch.createQcTemplate.useMutation({
    onSuccess: (row) => {
      utils.dispatch.listQcTemplates.setData(undefined, (old) => [...(old ?? []), row])
      setSelectedId(row.id)
    },
    onError: (error) => toastError({ title: 'Error adding check', description: error.message }),
  })

  const updateTemplate = api.dispatch.updateQcTemplate.useMutation({
    // Optimistic patch already applied; only reconcile from the server if the write failed.
    onError: (error) => {
      invalidate()
      toastError({ title: 'Error saving check', description: error.message })
    },
  })

  const deleteTemplate = api.dispatch.deleteQcTemplate.useMutation({
    onError: (error) => toastError({ title: 'Error deleting check', description: error.message }),
  })

  const reorderTemplates = api.dispatch.reorderQcTemplates.useMutation({
    onSettled: () => {
      setOrderOverride(null)
      invalidate()
    },
    onError: (error) =>
      toastError({ title: 'Error reordering checks', description: error.message }),
  })

  const selected = orderedTemplates.find((t) => t.id === selectedId) ?? null
  const isDraftSelected = draft !== null && selectedId === draft.draftId

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedTemplates.findIndex((t) => t.id === active.id)
    const newIndex = orderedTemplates.findIndex((t) => t.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    // The draft (if any) never enters `orderedTemplates` — it's local state rendered as a
    // trailing row outside the sortable list — so it can never appear in this payload.
    const reordered = arrayMove(orderedTemplates, oldIndex, newIndex)
    setOrderOverride(reordered)
    reorderTemplates.mutate(reordered.map((t, i) => ({ id: t.id, sortOrder: i })))
  }

  const patchTemplate = (id: string, patch: Partial<QcItemTemplateRow>) => {
    patchCached(id, patch)
    updateTemplate.mutate({ templateId: id, ...patch })
  }

  const handleToggleActive = (template: QcItemTemplateRow) => {
    patchTemplate(template.id, { isActive: !template.isActive })
  }

  /** Confirm + delete a template — cache removal, no refetch (products-list.tsx recipe).
   * Already-materialized visit checklists keep their snapshot rows (templateId FK is set-null). */
  const handleDelete = async (template: QcItemTemplateRow) => {
    const confirmed = await confirm({
      title: 'Delete check?',
      description: `“${template.title}” will be removed from the catalog. Checklists on existing visits are unaffected.`,
      confirmText: 'Delete',
      destructive: true,
    })
    if (!confirmed) return
    deleteTemplate.mutate(
      { templateId: template.id },
      {
        onSuccess: () => {
          utils.dispatch.listQcTemplates.setData(undefined, (old) =>
            old?.filter((t) => t.id !== template.id)
          )
          setOrderOverride((prev) => (prev ? prev.filter((t) => t.id !== template.id) : prev))
          if (selectedId === template.id) setSelectedId(null)
          // The deleted row may be a just-committed draft's record — drop the stale handle.
          if (draftRef.current?.recordId === template.id) dropDraft()
        },
      }
    )
  }

  /** Drop the draft handle + reset the commit-routing ref (called when selection leaves it). */
  const dropDraft = () => {
    setDraft(null)
    createdIdRef.current = null
  }

  const selectRow = (id: string) => {
    // Selecting anything other than the draft itself (or its committed record, which keeps the
    // draft editor mounted — see QcDraft.recordId) drops the draft. A committed draft is already
    // a real template, so dropping the handle loses nothing.
    const current = draftRef.current
    if (current && id !== current.draftId && id !== current.recordId) dropDraft()
    setSelectedId(id)
  }

  const handleAdd = () => {
    const current = draftRef.current
    if (current && !current.recordId) {
      // An uncommitted draft already exists — just re-select it (products-services-page recipe).
      setSelectedId(current.draftId)
      return
    }
    dropDraft()
    const draftId = generateId('draft')
    setDraft(freshQcDraft(draftId))
    setSelectedId(draftId)
  }

  /**
   * Draft commit path. Three phases (product-editor.tsx's `commitDraft` recipe):
   * 1. Already created (`createdIdRef` set — the editor stayed mounted through the swap): merge
   *    into draft state and route straight through the normal optimistic `patchTemplate` path.
   * 2. Create in flight: merge into draft state only — the diff-flush below picks it up.
   * 3. First commit: fire the ONE `createQcTemplate` call with everything accumulated so far.
   *    `title` is required server-side — an empty title falls back to `'New check'` (a later
   *    title edit renames it through phase 1). On success the hook-level `onSuccess` has already
   *    appended the row + swapped selection; here we flip `createdIdRef` FIRST (so racing
   *    commits route to phase 1), diff-flush edits typed during the round trip, and stamp
   *    `recordId` onto the draft — KEEPING it alive so the editor never remounts mid-typing.
   *    On error: clear the guard and keep the draft (nothing was created); the mutation's
   *    hook-level `onError` already toasts.
   */
  const commitDraft = (patch: Partial<Pick<QcDraft, 'title' | 'description' | 'isRequired'>>) => {
    const current = draftRef.current
    if (!current) return

    const createdId = createdIdRef.current
    if (createdId) {
      setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
      const changes: Partial<QcItemTemplateRow> = {}
      if (patch.title !== undefined) changes.title = patch.title
      if (patch.description !== undefined) changes.description = patch.description || null
      if (patch.isRequired !== undefined) changes.isRequired = patch.isRequired
      if (Object.keys(changes).length > 0) patchTemplate(createdId, changes)
      return
    }

    if (creatingDraftIdRef.current === current.draftId) {
      setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
      return
    }

    const snapshot: QcDraft = { ...current, ...patch }
    creatingDraftIdRef.current = current.draftId
    setDraft(snapshot)

    createTemplate.mutate(
      {
        title: snapshot.title.trim() || 'New check',
        description: snapshot.description || null,
        isRequired: snapshot.isRequired,
      },
      {
        onSuccess: (row) => {
          creatingDraftIdRef.current = null
          const latest = draftRef.current
          // Draft dropped/replaced during the round trip — the row was still created and
          // appended (hook-level onSuccess); nothing to route or flush.
          if (latest?.draftId !== snapshot.draftId) return

          // Flip the commit target FIRST — a commit landing while we flush below must route
          // through patchTemplate, not the buffered-create path.
          createdIdRef.current = row.id

          const changed: Partial<QcItemTemplateRow> = {}
          if (latest.title !== snapshot.title) changed.title = latest.title
          if (latest.description !== snapshot.description) {
            changed.description = latest.description || null
          }
          if (latest.isRequired !== snapshot.isRequired) changed.isRequired = latest.isRequired
          if (Object.keys(changed).length > 0) patchTemplate(row.id, changed)

          // Keep the draft alive, stamped — the list hides the phantom row (the real cached
          // row took its place) and the editor stays on the draft branch, unmounted only when
          // selection genuinely leaves.
          setDraft((prev) =>
            prev?.draftId === snapshot.draftId ? { ...prev, recordId: row.id } : prev
          )
        },
        onError: () => {
          if (creatingDraftIdRef.current === snapshot.draftId) creatingDraftIdRef.current = null
        },
      }
    )
  }

  // The draft editor also stays active while `selectedId` is the draft's committed recordId —
  // swapping to the template-bound editor would remount the inputs mid-typing (replaced text +
  // cancelled debounce timer).
  const draftActive =
    draft !== null &&
    (selectedId === draft.draftId || (!!draft.recordId && selectedId === draft.recordId))

  const mobileDrawerOpen = !isDesktop && (!!selected || draftActive)

  const editorContent =
    draftActive && draft ? (
      <TemplateEditor key={draft.draftId} draft={draft} onCommitDraft={commitDraft} />
    ) : selected ? (
      // Keyed by id so switching selection remounts the editor with fresh field state.
      <TemplateEditor key={selected.id} template={selected} onPatch={patchTemplate} />
    ) : (
      <div className='p-4 text-sm text-muted-foreground'>Select a check to edit.</div>
    )

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <SettingsPage
        title='Quality Checks'
        description='Manage the quality-check checklist workers complete on every visit.'
        breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Lock}
          title='Dispatch Not Available'
          description='Upgrade your plan to use quoting and dispatch.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage
      title='Quality Checks'
      description='Manage the quality-check checklist workers complete on every visit.'
      breadcrumbs={BREADCRUMBS}>
      <div className='grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]'>
        <div className='min-w-0'>
          <div className='flex flex-col gap-3 p-3'>
            <div className='flex items-center justify-end'>
              <Button variant='outline' size='sm' onClick={handleAdd}>
                <Plus />
                Add check
              </Button>
            </div>

            {orderedTemplates.length === 0 && !draft ? (
              <div className='p-4 text-center text-sm text-muted-foreground'>
                No checks yet — add one to start building the visit checklist.
              </div>
            ) : (
              <div className='flex flex-col gap-0.5'>
                {orderedTemplates.length > 0 && (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                    modifiers={[restrictToVerticalAxis]}>
                    <SortableContext
                      items={orderedTemplates.map((t) => t.id)}
                      strategy={verticalListSortingStrategy}>
                      {orderedTemplates.map((template) => (
                        <QualityCheckTreeRow
                          key={template.id}
                          template={template}
                          isSelected={selectedId === template.id}
                          onSelect={() => selectRow(template.id)}
                          onToggleActive={() => handleToggleActive(template)}
                          onDelete={() => handleDelete(template)}
                          isPending={updateTemplate.isPending}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                )}

                {draft && !draft.recordId && (
                  // Minimal inline draft row — not draggable (rendered outside the
                  // SortableContext above, so it can never enter a reorder payload), no
                  // Switch/Required badge (nothing to toggle until the row is real). Hidden
                  // once the draft committed — the real row is in the cache by then.
                  <TreeRow
                    icon={<span className='size-4' />}
                    isOpen={isDraftSelected}
                    onToggleOpen={() => setSelectedId(draft.draftId)}
                    rowClassName={cn(
                      'bg-primary-100/50 hover:bg-primary-100',
                      isDraftSelected && 'bg-primary-100 ring-1 ring-primary-200'
                    )}
                    title={
                      <span
                        className={cn('text-sm', !draft.title && 'text-muted-foreground italic')}>
                        {draft.title || 'Untitled check'}
                      </span>
                    }
                  />
                )}
              </div>
            )}
          </div>
        </div>
        <div className='hidden border-l lg:block'>{editorContent}</div>
      </div>

      <DockableDrawer
        open={mobileDrawerOpen}
        onOpenChange={(open) => {
          if (!open) {
            dropDraft()
            setSelectedId(null)
          }
        }}
        isDocked={false}
        width={380}
        onWidthChange={() => {}}
        minWidth={320}
        maxWidth={480}
        title='Edit check'>
        {editorContent}
      </DockableDrawer>

      <ConfirmDialog />
    </SettingsPage>
  )
}

type TemplateEditorProps =
  | {
      template: QcItemTemplateRow
      onPatch: (id: string, patch: Partial<QcItemTemplateRow>) => void
      draft?: undefined
      onCommitDraft?: undefined
    }
  | {
      draft: QcDraft
      onCommitDraft: (patch: Partial<Pick<QcDraft, 'title' | 'description' | 'isRequired'>>) => void
      template?: undefined
      onPatch?: undefined
    }

/**
 * The selected template's (or draft's) FieldPanel editor — remounted per template/draft (see the
 * `key` above), so text fields can seed local state once and autosave on change (debounced),
 * mirroring `product-editor.tsx`. Active lives on the list row, not here. In draft mode, commits
 * route through `onCommitDraft` instead of `onPatch`, and the title input autofocuses on mount.
 */
function TemplateEditor(props: TemplateEditorProps) {
  const [title, setTitle] = useState(props.draft ? props.draft.title : props.template.title)
  const [description, setDescription] = useState(
    props.draft ? props.draft.description : (props.template.description ?? '')
  )
  const isRequired = props.draft ? props.draft.isRequired : props.template.isRequired

  const commitTitle = useDebouncedCallback((value: string) => {
    if (props.draft) props.onCommitDraft({ title: value })
    else props.onPatch(props.template.id, { title: value })
  }, 500)
  const commitDescription = useDebouncedCallback((value: string) => {
    if (props.draft) props.onCommitDraft({ description: value })
    else props.onPatch(props.template.id, { description: value || null })
  }, 500)

  const commitRequired = (value: boolean) => {
    if (props.draft) props.onCommitDraft({ isRequired: value })
    else props.onPatch(props.template.id, { isRequired: value })
  }

  return (
    <div className='p-3'>
      <FieldPanel
        orientation='horizontal'
        breakpoint='md'
        resizeId='qc-template-form'
        defaultLabelWidth={140}
        className='p-0'>
        <FieldPanelRow title='Title' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={title}
            open={props.draft ? true : undefined}
            onChange={(value) => {
              setTitle(value as string)
              commitTitle(value as string)
            }}
            placeholder='Check title'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Description' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            fieldOptions={{ multiline: true }}
            value={description}
            onChange={(value) => {
              setDescription(value as string)
              commitDescription(value as string)
            }}
            placeholder='Optional detail shown to the worker on the visit'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Required' type={BaseType.BOOLEAN} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={isRequired}
            onChange={(value) => commitRequired(Boolean(value))}
          />
        </FieldPanelRow>
      </FieldPanel>
    </div>
  )
}
