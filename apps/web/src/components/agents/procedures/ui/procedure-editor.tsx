// apps/web/src/components/agents/procedures/ui/procedure-editor.tsx
'use client'

import Section, { EmptySection } from '@auxx/ui/components/section'
import { ListChecks } from 'lucide-react'
import { useCallback } from 'react'
import { ProcedureBlocksPopover } from './procedure-blocks-popover'
import { type ProcedureDraftContextValue, useProcedureDraft } from './procedure-draft-provider'
import { ProcedureTriggerHeader } from './procedure-trigger-header'
import { ProseEditorCard } from './prose-editor-card'

/**
 * The procedure authoring canvas — slimmed to the ROOT prose surface (v9 Phase 6).
 * Sub-procedure and code-block bodies no longer drill inside a private inner NavStack:
 * they're a third panel on the outer `agent-detail-tabs` NavStack ({@link ProcedureDrillPanel}).
 * This component is now just the main body editor + its header (expand-to-dialog / copy /
 * char-count), reading the single lifted owner ({@link useProcedureDraft}). The `@` picker
 * and procedure nodes are on; the inline badge cog calls `openDrill` through context.
 *
 * Visual structure mirrors the persona editor (focus-gradient border, header actions,
 * expand-to-dialog) — only the drill is gone.
 */
export function ProcedureEditor() {
  // Guard the brief procedure→root pop where the owner has unmounted but
  // AnimatePresence still holds this exiting panel — render nothing then (no hooks
  // run in the body, so this is safe).
  const draft = useProcedureDraft()
  if (!draft) return null
  return <ProcedureEditorBody draft={draft} />
}

function ProcedureEditorBody({ draft }: { draft: ProcedureDraftContextValue }) {
  const {
    procedureId,
    meta,
    isLoading,
    mainContent,
    handleMainChange,
    activeEditor,
    handleEditorReady,
    referencePickerRef,
    localAttributes,
    patchMeta,
  } = draft

  const handlePatch = useCallback((p: Parameters<typeof patchMeta>[0]) => patchMeta(p), [patchMeta])

  if (isLoading || !meta) return <EmptySection loading className='mx-3 my-3' />

  return (
    <>
      <ProcedureTriggerHeader
        key={procedureId}
        whenToUse={meta.whenToUse}
        triggerExamples={meta.triggerExamples}
        ruleset={meta.ruleset}
        localAttributes={localAttributes}
        onPatch={handlePatch}
      />
      <Section
        title='Procedure'
        icon={<ListChecks className='size-4' />}
        description='Describe the situation that should select this procedure.'
        actions={<ProcedureBlocksPopover />}
        initialOpen
        collapsible={false}>
        <ProseEditorCard
          title='Procedure'
          initialContent={mainContent}
          onChange={handleMainChange}
          activeEditor={activeEditor}
          onEditorReady={handleEditorReady}
          referencePickerRef={referencePickerRef}
        />
      </Section>
    </>
  )
}
