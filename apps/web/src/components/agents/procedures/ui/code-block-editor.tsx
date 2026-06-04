// apps/web/src/components/agents/procedures/ui/code-block-editor.tsx
'use client'

import { Textarea } from '@auxx/ui/components/textarea'

interface CodeBlockEditorProps {
  code: string
  onChange: (code: string) => void
}

/**
 * The drilled body for a `code:<id>` badge — a plain monospace editor over the
 * code-block's JavaScript. Reached by the badge cog (NavStack push); the body
 * lives in the doc-level `codeBlocks` map, never inline in the prose (plan §6).
 * The full inputs/outputs binding UI is a follow-up; today the script reads /
 * writes declared attributes by name.
 */
export function CodeBlockEditor({ code, onChange }: CodeBlockEditorProps) {
  return (
    <div className='w-full py-3'>
      <Textarea
        value={code}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        placeholder='// JavaScript — read/write declared attributes by name'
        className='min-h-64 w-full resize-none border-0 font-mono text-xs focus-visible:ring-0'
      />
    </div>
  )
}
