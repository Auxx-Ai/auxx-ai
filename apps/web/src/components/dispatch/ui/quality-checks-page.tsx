// apps/web/src/components/dispatch/ui/quality-checks-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { toastError } from '@auxx/ui/components/toast'
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
import { useState } from 'react'
import type { QcItemTemplateRow } from '~/components/dispatch/ui/quality-check-tree-row'
import { QualityCheckTreeRow } from '~/components/dispatch/ui/quality-check-tree-row'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import SettingsPage from '~/components/global/settings-page'
import { BaseType } from '~/components/workflow/types'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { useMedia } from '~/hooks/use-media'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

const BREADCRUMBS = [{ title: 'Dispatch Settings' }, { title: 'Quality Checks' }]

/**
 * Dispatch Quality Checks settings page (plans/dispatch/08-worker-surface.md §5): the
 * admin-managed catalog of QC item templates a worker's per-visit checklist is materialized from.
 * Master-detail mirroring the Products & Services page — a sortable `TreeRow` list on the left
 * (active/inactive is a trailing `Switch`; templates are deactivate-not-delete) and a per-field
 * autosaving `FieldPanel` editor on the right (a `DockableDrawer` below `lg`). Create/toggle/edit
 * all update the cached list optimistically, reconciling from the server only on error.
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

  const isDesktop = useMedia('(min-width: 1024px)')

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

  const reorderTemplates = api.dispatch.reorderQcTemplates.useMutation({
    onSettled: () => {
      setOrderOverride(null)
      invalidate()
    },
    onError: (error) =>
      toastError({ title: 'Error reordering checks', description: error.message }),
  })

  const selected = orderedTemplates.find((t) => t.id === selectedId) ?? null

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

  const mobileDrawerOpen = !isDesktop && !!selected

  const editorContent = selected ? (
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
      <div className='grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]'>
        <div className='min-w-0'>
          <div className='flex flex-col gap-3 p-3'>
            <div className='flex items-center justify-end'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => createTemplate.mutate({ title: 'New check' })}
                loading={createTemplate.isPending}
                loadingText='Adding...'>
                <Plus />
                Add check
              </Button>
            </div>

            {orderedTemplates.length === 0 ? (
              <div className='p-4 text-center text-sm text-muted-foreground'>
                No checks yet — add one to start building the visit checklist.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToVerticalAxis]}>
                <SortableContext
                  items={orderedTemplates.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}>
                  <div className='flex flex-col gap-0.5'>
                    {orderedTemplates.map((template) => (
                      <QualityCheckTreeRow
                        key={template.id}
                        template={template}
                        isSelected={selectedId === template.id}
                        onSelect={() => setSelectedId(template.id)}
                        onToggleActive={() => handleToggleActive(template)}
                        isPending={updateTemplate.isPending}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>
        <div className='hidden border-l lg:block'>{editorContent}</div>
      </div>

      <DockableDrawer
        open={mobileDrawerOpen}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
        isDocked={false}
        width={380}
        onWidthChange={() => {}}
        minWidth={320}
        maxWidth={480}
        title='Edit check'>
        {editorContent}
      </DockableDrawer>
    </SettingsPage>
  )
}

/**
 * The selected template's FieldPanel editor — remounted per template (see the `key` above), so
 * text fields can seed local state once and autosave on change (debounced), mirroring
 * `product-editor.tsx`. Active lives on the list row, not here.
 */
function TemplateEditor({
  template,
  onPatch,
}: {
  template: QcItemTemplateRow
  onPatch: (id: string, patch: Partial<QcItemTemplateRow>) => void
}) {
  const [title, setTitle] = useState(template.title)
  const [description, setDescription] = useState(template.description ?? '')

  const commitTitle = useDebouncedCallback(
    (value: string) => onPatch(template.id, { title: value }),
    500
  )
  const commitDescription = useDebouncedCallback(
    (value: string) => onPatch(template.id, { description: value || null }),
    500
  )

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
            value={template.isRequired}
            onChange={(value) => onPatch(template.id, { isRequired: Boolean(value) })}
          />
        </FieldPanelRow>
      </FieldPanel>
    </div>
  )
}
