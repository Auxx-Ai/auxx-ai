// apps/web/src/components/agents/procedures/ui/code-outputs-editor.tsx
'use client'

import type { CodeOutput, LocalAttribute } from '@auxx/lib/agents/procedures/client'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

/**
 * The OUTPUT binding surface for a code block (v9 procedures, Phase 6). Sits above the
 * Monaco editor in the `code:` drill panel; edits the doc-level `codeBlocks` map entry's
 * `outputs` (the compiler lifts them onto the emitted `code` step). Inputs are gone in v9
 * — `main(inputs)` reads the ambient `{ vars, subject }` bag by path, nothing to wire.
 *
 *  - **Outputs** — `{ name, surfaceToModel }` rows. `name` is picked from the declared
 *    local attributes (a `result[name]` write to `var:<name>`); `surfaceToModel` decides
 *    whether the value feeds the model's prose or stays branch-only.
 *
 * Holds the rows in LOCAL state (seeded once on mount; the panel remounts keyed per
 * block) so editing stays responsive without re-rendering the parent. `onChange`
 * propagates into the editor's `codeRef` (the save source).
 */
export function CodeOutputsEditor({
  initialOutputs,
  localAttributes,
  onChange,
}: {
  initialOutputs: CodeOutput[]
  localAttributes: LocalAttribute[]
  onChange: (outputs: CodeOutput[]) => void
}) {
  const [outputs, setOutputsState] = useState<CodeOutput[]>(initialOutputs)
  const setOutputs = (next: CodeOutput[]) => {
    setOutputsState(next)
    onChange(next)
  }

  return (
    <div className='flex flex-col gap-2 px-1 pb-3'>
      <div className='flex items-center justify-between'>
        <Label className='text-xs text-muted-foreground'>Outputs → var:*</Label>
        <Button
          variant='ghost'
          size='sm'
          disabled={localAttributes.length === 0}
          onClick={() => setOutputs([...outputs, { name: '', surfaceToModel: false }])}>
          <Plus />
          Add output
        </Button>
      </div>
      {localAttributes.length === 0 && (
        <p className='text-xs text-muted-foreground'>
          Declare a local attribute (the `@` → Create attribute tab) to capture an output.
        </p>
      )}
      {outputs.map((output, i) => (
        <div key={i} className='flex items-center gap-2'>
          <Select
            value={output.name || undefined}
            onValueChange={(name) =>
              setOutputs(outputs.map((r, j) => (j === i ? { ...r, name } : r)))
            }>
            <SelectTrigger className='h-8 flex-1 text-xs'>
              <SelectValue placeholder='attribute' />
            </SelectTrigger>
            <SelectContent>
              {localAttributes.map((a) => (
                <SelectItem key={a.name} value={a.name}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className='flex items-center gap-1.5 text-xs text-muted-foreground'>
            <Checkbox
              checked={output.surfaceToModel}
              onCheckedChange={(checked) =>
                setOutputs(
                  outputs.map((r, j) => (j === i ? { ...r, surfaceToModel: checked === true } : r))
                )
              }
            />
            Show to model
          </label>
          <Button
            variant='ghost'
            size='icon'
            aria-label='Remove output'
            onClick={() => setOutputs(outputs.filter((_, j) => j !== i))}>
            <X />
          </Button>
        </div>
      ))}
    </div>
  )
}
