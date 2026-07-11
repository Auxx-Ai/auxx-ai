// apps/web/src/components/dispatch/ui/quality-checks-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
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
import { ClipboardCheck, Lock, Plus, Settings2 } from 'lucide-react'
import { useState } from 'react'
import type { QcItemTemplateRow } from '~/components/dispatch/ui/quality-check-tree-row'
import { QualityCheckTreeRow } from '~/components/dispatch/ui/quality-check-tree-row'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { EmptyState } from '~/components/global/empty-state'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import SettingsPage from '~/components/global/settings-page'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

const BREADCRUMBS = [{ title: 'Dispatch Settings' }, { title: 'Quality Checks' }]

interface TemplateDraft {
  title: string
  description: string
  isRequired: boolean
  isActive: boolean
}

function draftFromTemplate(template: QcItemTemplateRow | null): TemplateDraft {
  return {
    title: template?.title ?? '',
    description: template?.description ?? '',
    isRequired: template?.isRequired ?? false,
    isActive: template?.isActive ?? true,
  }
}

/**
 * Dispatch Quality Checks settings page (plans/dispatch/08-worker-surface.md §5): the
 * admin-managed catalog of QC item templates a worker's per-visit checklist is materialized
 * from (deactivate-not-delete — there is no delete affordance). Master-detail, mirroring
 * `RecordRuleActionsPage`'s shell: a sortable `TreeRow` list of templates, and a shared
 * `FieldPanel` editor below for the selected one, saved via the shared dirty-draft +
 * `FormSaveBar` (10-settings-forms-unification.md).
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

  const invalidate = () => utils.dispatch.listQcTemplates.invalidate()

  const createTemplate = api.dispatch.createQcTemplate.useMutation({
    onSuccess: (row) => {
      setSelectedId(row.id)
      invalidate()
    },
    onError: (error) => toastError({ title: 'Error adding check', description: error.message }),
  })

  const updateTemplate = api.dispatch.updateQcTemplate.useMutation({
    onSuccess: () => invalidate(),
    onError: (error) => toastError({ title: 'Error saving check', description: error.message }),
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

  const handleToggleActive = (template: QcItemTemplateRow) => {
    updateTemplate.mutate({ templateId: template.id, isActive: !template.isActive })
  }

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
      <div className='flex flex-col gap-8 p-3 sm:p-6'>
        <Section
          title='Checks'
          icon={<ClipboardCheck className='size-4' />}
          collapsible={false}
          actions={
            <Button
              variant='ghost'
              size='xs'
              onClick={() => createTemplate.mutate({ title: 'New check' })}
              loading={createTemplate.isPending}
              loadingText='Adding...'>
              <Plus />
              Add check
            </Button>
          }>
          {orderedTemplates.length === 0 ? (
            <EmptySection
              icon={<ClipboardCheck className='size-5' />}
              title='No checks yet'
              description='Add a check to start building the visit checklist.'
            />
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
        </Section>

        <Section
          title={selected ? `Configure · ${selected.title || 'Untitled'}` : 'Configure'}
          icon={<Settings2 className='size-4' />}
          collapsible={false}>
          {!selected ? (
            <EmptySection
              icon={<Settings2 className='size-5' />}
              title='No check selected'
              description='Select a check to configure it.'
            />
          ) : (
            // Keyed by id so switching selection remounts the editor with a fresh draft — a
            // dirty draft from check A must never be saveable onto check B.
            <TemplateEditor
              key={selected.id}
              template={selected}
              isSaving={updateTemplate.isPending}
              onSave={(next) =>
                updateTemplate.mutate({
                  templateId: selected.id,
                  title: next.title,
                  description: next.description || null,
                  isRequired: next.isRequired,
                  isActive: next.isActive,
                })
              }
            />
          )}
        </Section>
      </div>
    </SettingsPage>
  )
}

/** The selected template's FieldPanel editor — remounted per template (see the `key` above). */
function TemplateEditor({
  template,
  isSaving,
  onSave,
}: {
  template: QcItemTemplateRow
  isSaving: boolean
  onSave: (draft: TemplateDraft) => void
}) {
  const server = draftFromTemplate(template)
  const { draft, patch, dirty, save, discard } = useDirtyDraft(server, { isSaving, onSave })

  return (
    <div className='flex flex-col gap-3'>
      <FieldPanel className='p-0' breakpoint='md' resizeId='qc-template'>
        <FieldPanelRow title='Title' isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={draft.title}
            onChange={(v) => patch({ title: String(v ?? '') })}
            placeholder='Check title'
          />
        </FieldPanelRow>
        <FieldPanelRow title='Description'>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            fieldOptions={{ multiline: true }}
            value={draft.description}
            onChange={(v) => patch({ description: String(v ?? '') })}
            placeholder='Optional detail shown to the worker on the visit'
          />
        </FieldPanelRow>
        <FieldPanelRow title='Required'>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={draft.isRequired}
            onChange={(v) => patch({ isRequired: Boolean(v) })}
          />
        </FieldPanelRow>
        <FieldPanelRow title='Active'>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={draft.isActive}
            onChange={(v) => patch({ isActive: Boolean(v) })}
          />
        </FieldPanelRow>
      </FieldPanel>
      <FormSaveBar
        dirty={dirty}
        isSaving={isSaving}
        onSave={save}
        onDiscard={discard}
        saveDisabled={!draft.title.trim()}
      />
    </div>
  )
}
