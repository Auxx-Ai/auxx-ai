// apps/web/src/components/agents/procedures/ui/procedure-drill-panel.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { PromptEditorContent } from '~/components/editor/prompt-editor'
import CodeEditor, {
  type CodeEditorOutput,
  CodeLanguage,
} from '~/components/workflow/ui/code-editor'
import { CodeOutputsEditor } from './code-outputs-editor'
import { useProcedureDraft } from './procedure-draft-provider'
import { PROCEDURE_REFERENCE_TABS } from './procedure-editor'

/**
 * The full-height drilled body (v9 Phase 6) — the `drill` panel on the outer
 * `agent-detail-tabs` NavStack. ONE bar above it (the shared `ProcedureDetailBar`), so
 * no inner header. Reads the `drill` param + the live entry from the lifted draft owner:
 *
 *  - `sub:<id>` → a bare full-height prose editor on that sub-procedure's slice (no
 *    header; the detail bar is the only chrome). `@` picker + procedure nodes on.
 *  - `code:<id>` → the {@link CodeOutputsEditor} (declared outputs) above a full-height
 *    Monaco editor over the block's JavaScript. AI codegen is seeded from the declared
 *    local attributes (offered as outputs); a tip documents the ambient `inputs` bag.
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
    handleEditorReady,
    referencePickerRef,
  } = draft

  if (!drill) return null

  if (drill.startsWith('sub:')) {
    const id = drill.slice('sub:'.length)
    return (
      <div className='flex flex-1 flex-col min-h-0 px-3 py-2'>
        <PromptEditorContent
          initialContent={getSubContent(id)}
          onChange={makeSubChange(id)}
          onEditorReady={handleEditorReady}
          onFocusChange={() => {}}
          referencePickerRef={referencePickerRef}
          referenceTabs={PROCEDURE_REFERENCE_TABS}
          enableProcedureNodes
        />
      </div>
    )
  }

  if (drill.startsWith('code:')) {
    const id = drill.slice('code:'.length)
    const entry = getCodeEntry(id)
    // AI codegen — offer the declared attributes as the block's outputs.
    const codeOutputs: CodeEditorOutput[] = localAttributes.map((a) => ({
      name: a.name,
      type: dataTypeToJs(a.dataType),
    }))
    return (
      <div className='flex flex-1 flex-col min-h-0'>
        <div className='shrink-0 px-3 pt-2'>
          <CodeOutputsEditor
            initialOutputs={entry?.outputs ?? []}
            localAttributes={localAttributes}
            onChange={(outputs) => handleCodeOutputsChange(id, outputs)}
          />
        </div>
        <div className='flex flex-1 flex-col min-h-0'>
          <CodeEditor
            noWrapper
            isExpand
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
