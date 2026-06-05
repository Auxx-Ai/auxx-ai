// apps/web/src/components/agents/procedures/ui/code-bindings-editor.tsx
'use client'

import type { CodeInput, CodeOutput, LocalAttribute } from '@auxx/lib/agents/procedures/client'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Input } from '@auxx/ui/components/input'
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
 * The input/output binding surface for a code block (v9 procedures, Phase 5 §5). Lives
 * above the {@link CodeBlockEditor} in the `code:` drill-in panel; edits the doc-level
 * `codeBlocks` map entry's `inputs`/`outputs` (the compiler lifts them onto the emitted
 * `code` step). Bindings are per-block — a block invoked once (the common case) reads as
 * its single invocation's contract.
 *
 *  - **Inputs** — `{ name, ref }` rows passed to `main(codeInput)`. `ref` is a free-text
 *    field (a local `var:<name>` or a CRM `FieldReference` like `contact:email`); the
 *    declared local attributes are offered as a datalist. The compiler rejects an
 *    unresolvable ref at publish (`BAD_INPUT_REF`).
 *  - **Outputs** — `{ name, surfaceToModel }` rows. `name` is picked from the declared
 *    local attributes (a `result[name]` write to `var:<name>`); `surfaceToModel` decides
 *    whether the value feeds the model's prose or stays branch-only.
 *
 * Holds the rows in LOCAL state (seeded once on mount; the panel remounts keyed per
 * block) so editing stays responsive without re-rendering the parent `ProcedureEditor`.
 * `onChange` propagates into the editor's `codeRef` (the save source), mirroring
 * {@link CodeBlockEditor}.
 */
export function CodeBindingsEditor({
  initialInputs,
  initialOutputs,
  localAttributes,
  onChange,
}: {
  initialInputs: CodeInput[]
  initialOutputs: CodeOutput[]
  localAttributes: LocalAttribute[]
  onChange: (next: { inputs: CodeInput[]; outputs: CodeOutput[] }) => void
}) {
  const [inputs, setInputsState] = useState<CodeInput[]>(initialInputs)
  const [outputs, setOutputsState] = useState<CodeOutput[]>(initialOutputs)
  const setInputs = (next: CodeInput[]) => {
    setInputsState(next)
    onChange({ inputs: next, outputs })
  }
  const setOutputs = (next: CodeOutput[]) => {
    setOutputsState(next)
    onChange({ inputs, outputs: next })
  }

  const datalistId = 'code-input-ref-suggestions'

  return (
    <div className='flex flex-col gap-4 px-1 pb-3'>
      {/* Inputs */}
      <div className='flex flex-col gap-2'>
        <div className='flex items-center justify-between'>
          <Label className='text-xs text-muted-foreground'>Inputs → main(codeInput)</Label>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => setInputs([...inputs, { name: '', ref: '' }])}>
            <Plus />
            Add input
          </Button>
        </div>
        <datalist id={datalistId}>
          {localAttributes.map((a) => (
            <option key={a.name} value={`var:${a.name}`} />
          ))}
        </datalist>
        {inputs.length === 0 && (
          <p className='text-xs text-muted-foreground'>
            No inputs — the block receives an empty object.
          </p>
        )}
        {inputs.map((input, i) => (
          <div key={i} className='flex items-center gap-2'>
            <Input
              value={input.name}
              placeholder='name'
              className='h-8 flex-1 text-xs'
              onChange={(e) =>
                setInputs(inputs.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
              }
            />
            <Input
              value={input.ref}
              placeholder='var:cartTotal or contact:email'
              list={datalistId}
              className='h-8 flex-[2] font-mono text-xs'
              onChange={(e) =>
                setInputs(inputs.map((r, j) => (j === i ? { ...r, ref: e.target.value } : r)))
              }
            />
            <Button
              variant='ghost'
              size='icon'
              aria-label='Remove input'
              onClick={() => setInputs(inputs.filter((_, j) => j !== i))}>
              <X />
            </Button>
          </div>
        ))}
      </div>

      {/* Outputs */}
      <div className='flex flex-col gap-2'>
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
                    outputs.map((r, j) =>
                      j === i ? { ...r, surfaceToModel: checked === true } : r
                    )
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
    </div>
  )
}
