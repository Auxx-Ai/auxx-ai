// apps/web/src/components/agents/procedures/ui/code-block-editor.tsx
'use client'

import { Textarea } from '@auxx/ui/components/textarea'
import { useState } from 'react'

interface CodeBlockEditorProps {
  /** Seed value, read once on mount. The editor remounts (keyed) on reload. */
  code: string
  onChange: (code: string) => void
}

/**
 * The drilled body for a `code:<id>` badge — a plain monospace editor over the
 * code-block's JavaScript. Reached by the badge cog (NavStack push); the body
 * lives in the doc-level `codeBlocks` map, never inline in the prose (plan §6).
 * The full inputs/outputs binding UI is a follow-up; today the script reads /
 * writes declared attributes by name.
 *
 * Holds the text in LOCAL state so typing stays responsive without re-rendering
 * the parent `ProcedureEditor` on every keystroke — `onChange` propagates into
 * the editor's `codeRef` (the save source), not React state.
 */
export function CodeBlockEditor({ code, onChange }: CodeBlockEditorProps) {
  const [value, setValue] = useState(code)
  return (
    <div className='w-full py-3'>
      <Textarea
        value={value}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value)
          onChange(e.target.value)
        }}
        placeholder='// JavaScript — read/write declared attributes by name'
        className='min-h-64 w-full resize-none border-0 font-mono text-xs focus-visible:ring-0'
      />
    </div>
  )
}
