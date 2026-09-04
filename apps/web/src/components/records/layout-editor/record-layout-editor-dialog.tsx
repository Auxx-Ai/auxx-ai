// apps/web/src/components/records/layout-editor/record-layout-editor-dialog.tsx
'use client'

import type {
  CreatedBlock,
  RecordLayoutSurface,
  ResolvedLayout,
} from '@auxx/lib/record-layout/client'
import { parseFieldsBlockConfig, parseRecordsBlockConfig } from '@auxx/lib/record-layout/client'
import type { LayoutBlock } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import { Building2, User } from 'lucide-react'
import { type JSX, useState } from 'react'
import { useSaveRecordLayout } from '~/components/records/layout/use-record-layout'
import { useConfirm } from '~/hooks/use-confirm'
import {
  addBlockToTab,
  createTab,
  deleteCreatedBlock,
  deleteCreatedTab,
  setBlockHidden,
  updateCreatedTab,
} from './editor-actions'
import { planLayoutSave } from './layout-diff'
import { LayoutEditorTree } from './layout-editor-tree'
import { NewSectionForm } from './new-section-form'
import { useBlockEmptyHere } from './use-block-empty-here'
import { useLayoutEditor } from './use-layout-editor'

export interface RecordLayoutEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityDefinitionId: string
  entityType: string
  surface: RecordLayoutSurface
  /** Resolved layout as currently rendered, the editor's starting point. */
  layout: ResolvedLayout
  /** Whether the viewer may write the ORG scope. False means personal-only. */
  canAdministerDef: boolean
  /**
   * The record the dialog was opened from, if any.
   *
   * Used only to MARK sections that would render nothing for that one record
   * (§9.3). The layout is per definition, so this can never decide what the tree
   * lists: a DOM-derived tree would hide blocks that exist for every other
   * record of the same definition, which is exactly the mistake this prop is
   * shaped to avoid.
   */
  recordId?: string
}

/** Which page of the dialog is showing. */
type EditorPage = 'tree' | 'new-records' | 'new-fields'

/**
 * The record layout editor (`plans/drawer/record-layout-system.md` §9).
 *
 * Replaces the cog-wheel "Customize tabs" dialog that used to live in
 * `packages/ui/src/components/tabs.tsx`. It moved here because the section tree
 * needs the block registry, `useAccess`, entity definitions and tRPC, none of
 * which belong in the shared UI package: `packages/ui` keeps the primitives it
 * should own (`TreeRow`, dialog chrome, `icon-picker`) and this composes them.
 *
 * **Two scopes in one dialog (§9.5), and this is the subtle part.** Per-user tab
 * order and hiding already ships for every member, so gating the cog on
 * def-admin would take a working feature away from ordinary members. The dialog
 * therefore writes two layers:
 *
 * | Scope | Who | What |
 * | --- | --- | --- |
 * | Personal | any member | tab order, tab hidden |
 * | Org | def admin | section placement, tab creation, section hidden |
 *
 * They are distinguished three ways: the legend under the title names both, the
 * org-scope controls are ABSENT rather than inert for a member who cannot write
 * that layer, and the footer states the scope of what Save is about to write
 * because Save now changes the drawer for everyone in the org rather than for
 * one person.
 *
 * Edits stage locally and commit on Save; Cancel and Esc discard the whole
 * session, so the caller only ever sees one consistent write.
 */
export function RecordLayoutEditorDialog({
  open,
  onOpenChange,
  entityDefinitionId,
  entityType,
  surface,
  layout,
  canAdministerDef,
  recordId,
}: RecordLayoutEditorDialogProps): JSX.Element {
  const editor = useLayoutEditor({ open, entityDefinitionId, entityType, surface, layout })
  const {
    saveOrgDelta,
    savePersonalDelta,
    resetOrgLayout,
    resetPersonalLayout,
    saveOrg,
    savePersonal,
    resetOrg,
    resetPersonal,
  } = useSaveRecordLayout({ entityDefinitionId, surface })
  const isBlockEmptyHere = useBlockEmptyHere(recordId, editor.state.blocks, open)
  const [confirm, ConfirmDialog] = useConfirm()

  const [page, setPage] = useState<EditorPage>('tree')
  /** The tab a newly created section is being added to. */
  const [targetTabId, setTargetTabId] = useState<string | null>(null)
  /** The tab whose label should take focus (just created in this session). */
  const [newTabId, setNewTabId] = useState<string | null>(null)

  const isPending =
    saveOrg.isPending || savePersonal.isPending || resetOrg.isPending || resetPersonal.isPending

  const close = () => {
    setPage('tree')
    setTargetTabId(null)
    setNewTabId(null)
    onOpenChange(false)
  }

  const handleCreateTab = () => {
    const id = generateId('tab')
    editor.update((prev) => createTab(prev, { id, label: 'New tab', icon: 'folder' }))
    setNewTabId(id)
  }

  const handleAddBlock = (tabId: string, block: LayoutBlock) => {
    // Re-adding a section that was hidden is the common case, so the un-hide and
    // the placement travel together: otherwise the section would land on the
    // tab and stay invisible.
    editor.update((prev) => addBlockToTab(setBlockHidden(prev, block.id, false), { block, tabId }))
  }

  /**
   * Stage a block the admin just defined.
   *
   * The staged `LayoutBlock` is built through the same schemas the resolver will
   * use on the way back in, so the tree shows exactly what the drawer will. Note
   * what it does NOT carry: a created block never gets a `permissionKey`, a
   * `featureGate` or a `recordResource` here. Those are registry facts, and a
   * related list's gate is DERIVED by the resolver from the definition it lists
   * (§7): restating one in the staged copy is how the two would drift.
   */
  const handleCreatedBlock = (created: CreatedBlock) => {
    const tabId = targetTabId
    if (!tabId) return
    const id = generateId('blk')

    const block: LayoutBlock | null =
      created.kind === 'records'
        ? (() => {
            const config = parseRecordsBlockConfig(created.config)
            return config
              ? { id, kind: 'records' as const, label: created.label, icon: created.icon, config }
              : null
          })()
        : {
            id,
            kind: 'fields' as const,
            label: created.label,
            icon: created.icon,
            config: parseFieldsBlockConfig(created.config) ?? {},
          }

    if (!block) {
      toastError({
        title: 'Could not add that section',
        description: 'Choose what the section should list, then try again.',
      })
      return
    }

    editor.update((prev) => addBlockToTab(prev, { block, tabId, created }))
    setTargetTabId(null)
    setPage('tree')
  }

  const writes = planLayoutSave({
    canAdministerDef,
    orgDirty: editor.orgDirty,
    personalDirty: editor.personalDirty,
    deltas: editor.deltas,
  })

  const handleSave = async () => {
    try {
      for (const write of writes) {
        if (write.scope === 'org') await saveOrgDelta(write.delta)
        else await savePersonalDelta(write.delta)
      }
      close()
    } catch (error) {
      toastError({
        title: 'Error saving layout',
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }

  /**
   * "Reset to default" clears every layer the actor may write.
   *
   * It used to clear one user's localStorage; for an admin it now DELETES the
   * org override as well, which returns the layout to the shipped default for
   * everyone. That is why it confirms first, and only in that case: resetting
   * one's own tab order is the same low-stakes click it has always been.
   *
   * Both layers go, deliberately. Deleting the org row alone would leave the
   * admin's own tab order still overriding it, so the button would visibly not
   * reset the thing it just claimed to reset.
   */
  const handleReset = async () => {
    if (canAdministerDef) {
      const confirmed = await confirm({
        title: 'Reset this layout?',
        description:
          'Every section placement, created tab and hidden section on this definition returns to the shipped default, for everyone in your organization.',
        confirmText: 'Reset layout',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
    }
    try {
      if (canAdministerDef) await resetOrgLayout()
      await resetPersonalLayout()
      close()
    } catch (error) {
      toastError({
        title: 'Error resetting layout',
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }

  return (
    <>
      <ConfirmDialog />
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
        <DialogContent size='content' position='tc' innerClassName='p-0'>
          <DialogNav
            title='Customize layout'
            description='Tabs and the sections on them.'
            onBack={page === 'tree' ? undefined : () => setPage('tree')}
            crumbs={[
              { label: 'Layout', onClick: page === 'tree' ? undefined : () => setPage('tree') },
              ...(page === 'new-records' ? [{ label: 'New related list' }] : []),
              ...(page === 'new-fields' ? [{ label: 'New field group' }] : []),
            ]}
          />
          <DialogNavPages value={page}>
            <DialogNavPage value='tree' size='md'>
              <div className='flex flex-col gap-3'>
                <ScopeLegend canAdministerDef={canAdministerDef} />
                <ScrollArea className='max-h-[52vh] p-3'>
                  <LayoutEditorTree
                    state={editor.state}
                    update={editor.update}
                    catalog={editor.catalog}
                    isBlockVisible={editor.isBlockVisible}
                    isBlockEmptyHere={isBlockEmptyHere}
                    canAdministerDef={canAdministerDef}
                    newTabId={newTabId}
                    onCreateTab={handleCreateTab}
                    onDeleteTab={(tabId) => editor.update((prev) => deleteCreatedTab(prev, tabId))}
                    onRenameTab={(tabId, label) =>
                      editor.update((prev) => updateCreatedTab(prev, tabId, { label }))
                    }
                    onChangeTabIcon={(tabId, icon) =>
                      editor.update((prev) => updateCreatedTab(prev, tabId, { icon }))
                    }
                    onAddBlock={handleAddBlock}
                    onDeleteBlock={(blockId) =>
                      editor.update((prev) => deleteCreatedBlock(prev, blockId))
                    }
                    onCreateRecordsBlock={(tabId) => {
                      setTargetTabId(tabId)
                      setPage('new-records')
                    }}
                    onCreateFieldsBlock={(tabId) => {
                      setTargetTabId(tabId)
                      setPage('new-fields')
                    }}
                  />
                </ScrollArea>

                <DialogFooter className='items-center'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => void handleReset()}
                    disabled={isPending}
                    className='mr-auto'>
                    Reset to default
                  </Button>
                  <Button variant='ghost' size='sm' onClick={close} disabled={isPending}>
                    Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    loading={isPending}
                    loadingText='Saving...'
                    disabled={writes.length === 0}
                    onClick={() => void handleSave()}
                    data-dialog-submit>
                    Save <KbdSubmit variant='outline' size='sm' />
                  </Button>
                </DialogFooter>
              </div>
            </DialogNavPage>

            <DialogNavPage value='new-records' size='md'>
              <NewSectionForm
                kind='records'
                entityDefinitionId={entityDefinitionId}
                onCancel={() => setPage('tree')}
                onCreate={handleCreatedBlock}
              />
            </DialogNavPage>
            <DialogNavPage value='new-fields' size='md'>
              <NewSectionForm
                kind='fields'
                entityDefinitionId={entityDefinitionId}
                onCancel={() => setPage('tree')}
                onCreate={handleCreatedBlock}
              />
            </DialogNavPage>
          </DialogNavPages>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * The scope legend.
 *
 * Save writes for the whole organization now, not for one person, so the two
 * scopes have to be readable before anything is dragged, not only in the
 * footer after the fact.
 */
function ScopeLegend({ canAdministerDef }: { canAdministerDef: boolean }) {
  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-primary-50 px-3 py-2 text-muted-foreground text-xs'>
      <span className='flex items-center gap-1.5'>
        <User className='size-3.5' />
        Which tabs you see, and their order: only you.
      </span>
      <span className='flex items-center gap-1.5'>
        <Building2 className='size-3.5' />
        {canAdministerDef
          ? 'Sections and tabs you create: everyone in your organization.'
          : 'Sections are managed by an administrator.'}
      </span>
    </div>
  )
}
