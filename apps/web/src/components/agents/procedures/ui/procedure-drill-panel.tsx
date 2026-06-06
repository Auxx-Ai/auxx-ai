// apps/web/src/components/agents/procedures/ui/procedure-drill-panel.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import CodeEditor, {
  type CodeEditorOutput,
  CodeLanguage,
} from '~/components/workflow/ui/code-editor'
import { CodeOutputsEditor } from './code-outputs-editor'
import { useProcedureDraft } from './procedure-draft-provider'
import { ProseEditorCard } from './prose-editor-card'

/**
 * The full-height drilled body (v9 Phase 6) — the `drill` panel on the outer
 * `agent-detail-tabs` NavStack. The shared `ProcedureDetailBar` sits above it; each body
 * carries its OWN editor wrapper + header (titled with the block name) so the drilled view
 * reads as a first-class editor, not a bare canvas. Reads the `drill` param + the live
 * entry from the lifted draft owner:
 *
 *  - `sub:<id>` → the shared {@link ProseEditorCard} (focus-gradient border + header with
 *    copy / char-count / expand) filling the panel height. `@` picker + procedure nodes on.
 *  - `code:<id>` → the {@link CodeOutputsEditor} (declared outputs) above the `CodeEditor`
 *    in its OWN wrapper (gradient border + header with format / copy / expand). AI codegen
 *    is seeded from the declared local attributes (offered as outputs); a tip documents the
 *    ambient `inputs` bag.
 */
export function ProcedureDrillPanel() {
  // Null during the procedure→root pop where this panel is still mounted by
  // AnimatePresence after the owner unmounted (one hook, then guard — hooks-safe).
  const draft = useProcedureDraft()
  if (!draft) return null

  const {
    drill,
    getSubContent,
    makeSubChange,
    getCodeEntry,
    handleCodeChange,
    handleCodeOutputsChange,
    localAttributes,
    subProcedures,
    codeBlocks,
    activeEditor,
    handleEditorReady,
    referencePickerRef,
  } = draft

  if (!drill) return null

  if (drill.startsWith('sub:')) {
    const id = drill.slice('sub:'.length)
    const name = subProcedures.find((s) => s.id === id)?.name ?? 'Sub-procedure'
    return (
      <div className='flex flex-1 flex-col min-h-0 p-3'>
        <ProseEditorCard
          fill
          title={name}
          initialContent={getSubContent(id)}
          onChange={makeSubChange(id)}
          activeEditor={activeEditor}
          onEditorReady={handleEditorReady}
          referencePickerRef={referencePickerRef}
        />
      </div>
    )
  }

  if (drill.startsWith('code:')) {
    const id = drill.slice('code:'.length)
    const entry = getCodeEntry(id)
    const name = codeBlocks.find((c) => c.id === id)?.name ?? 'Code'
    // AI codegen — offer the declared attributes as the block's outputs.
    const codeOutputs: CodeEditorOutput[] = localAttributes.map((a) => ({
      name: a.name,
      type: dataTypeToJs(a.dataType),
    }))
    return (
      <div className='flex flex-1 flex-col gap-2 min-h-0 p-3'>
        <div className='shrink-0'>
          <CodeOutputsEditor
            initialOutputs={entry?.outputs ?? []}
            localAttributes={localAttributes}
            onChange={(outputs) => handleCodeOutputsChange(id, outputs)}
          />
        </div>
        <CodeEditor
          fill
          title={name}
          language={CodeLanguage.javascript}
          value={entry?.code ?? ''}
          onChange={(code) => handleCodeChange(id, code)}
          enableWorkflowCompletions={false}
          placeholder='// function main(inputs) { … return { <attr>: value } }'
          codeInputs={[
            {
              name: 'inputs',
              description:
                'inputs.vars.<attr> (declared attributes), inputs.subject.<anchor>.<field> (record fields)',
            },
          ]}
          codeOutputs={codeOutputs}
          tip={
            <p className='text-xs text-muted-foreground'>
              <code>main(inputs)</code> receives <code>inputs.vars.&lt;attr&gt;</code> and{' '}
              <code>inputs.subject.&lt;anchor&gt;.&lt;field&gt;</code>; return{' '}
              <code>{'{ <attr>: value }'}</code> to write declared outputs.
            </p>
          }
        />
      </div>
    )
  }

  return null
}

/** Map an attribute's `FieldType` to a JS-ish type hint for AI codegen output signatures. */
function dataTypeToJs(dataType: FieldType): string {
  switch (dataType) {
    case 'NUMBER':
    case 'CURRENCY':
    case 'CALC':
      return 'number'
    case 'CHECKBOX':
      return 'boolean'
    case 'TAGS':
    case 'MULTI_SELECT':
      return 'string[]'
    case 'JSON':
    case 'ADDRESS_STRUCT':
      return 'object'
    default:
      return 'string'
  }
}
