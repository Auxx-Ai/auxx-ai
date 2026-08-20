// apps/web/src/components/workflow/nodes/shared/default-values-editor.tsx

'use client'

import {
  defaultValueTargets,
  type ErrorDefaultValue,
  type NodeErrorHandling,
  type UnifiedVariable,
} from '@auxx/lib/workflow-engine/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import Field from '~/components/workflow/ui/field'
import { VarEditor, varEditorText } from '~/components/workflow/ui/input-editor/var-editor'
import { containsVariableReference } from '~/components/workflow/utils/variable-utils'

/**
 * `default_values[].type` for a target's declared `BaseType`.
 *
 * The persisted `type` is what `coerceDefaultValue` switches on at run time,
 * so it is DERIVED from the picked output rather than chosen by the author —
 * the 5-option "type" `<Select>` that used to sit next to every row is gone.
 * A row could previously say `number` while targeting a string output, and
 * nothing anywhere reconciled the two.
 */
function defaultValueTypeFor(type: BaseType): ErrorDefaultValue['type'] {
  switch (type) {
    case BaseType.NUMBER:
      return 'number'
    case BaseType.BOOLEAN:
      return 'boolean'
    case BaseType.OBJECT:
      return 'object'
    case BaseType.ARRAY:
      return 'array'
    default:
      return 'string'
  }
}

/**
 * The `BaseType` whose constant input a row's persisted `type` deserves.
 *
 * The INVERSE of {@link defaultValueTypeFor}, and deliberately coarser than
 * the target's declared type: a substitute is coerced by
 * `coerceDefaultValue(row.type, …)`, which knows five kinds and nothing else.
 * Driving the input off the declared type instead would offer a relation
 * picker for a `RELATION` output whose substitute the runtime will hand
 * straight through as a string, and would need `fieldOptions.fieldReference`
 * — a resource binding this editor has no business resolving.
 *
 * The row ICON still shows the declared type, so the author can see they are
 * writing a record id into a Relation while the box stays a text box.
 */
function constantInputTypeFor(type: ErrorDefaultValue['type']): BaseType {
  switch (type) {
    case 'number':
      return BaseType.NUMBER
    case 'boolean':
      return BaseType.BOOLEAN
    case 'object':
      return BaseType.OBJECT
    case 'array':
      return BaseType.ARRAY
    default:
      return BaseType.STRING
  }
}

/**
 * Every declared output is an admissible source for every substitute, so the
 * picker is deliberately UNFILTERED (`[ANY]` short-circuits
 * `isTypeCompatible`). Both processors interpolate `{{…}}` textually and only
 * then coerce per the row's `type`, so there is no variable a row cannot hold
 * — a type filter here would forbid what the runtime already accepts.
 */
const UNFILTERED: BaseType[] = [BaseType.ANY]

interface DefaultValuesEditorProps {
  /** Canvas node id — the variable picker needs it, and target paths are relative to it. */
  nodeId: string
  /** What the node's `resolveOutputs` returned. Targets are derived from this. */
  declaredOutputs: UnifiedVariable[]
  /** The manifest's declaration, for `defaultValueExclude`. */
  errorHandling: NodeErrorHandling | undefined
  values: ErrorDefaultValue[]
  onChange: (values: ErrorDefaultValue[]) => void
  isReadOnly?: boolean
  /** Overrides the `Field` header copy for a node whose failure reads differently. */
  description?: string
  /** Validation messages the panel wants under the rows. */
  footer?: ReactNode
}

/**
 * The ONE editor for the `default` failure policy's substitute values.
 *
 * Replaces two unrelated UIs for one concept (plan 24 §9.3): http's fixed
 * three-field form with hard-coded keys and no way to add or remove a row, and
 * the generic free-text key/type/value list crud and ai shared.
 *
 * **The key is picked, never typed** — plan 24's O5 decision. Every row targets
 * a path the node's manifest actually declares, which fixes four things at
 * once:
 *
 * - a configured substitute is now readable downstream. Free-text keys were
 *   written to the namespace, were not offered by the picker, and any ref to
 *   one was REJECTED by `ref-check` — the feature produced values you were
 *   forbidden to use (§9.5).
 * - the resulting written-but-undeclared drift no longer has to be pinned as
 *   correct-by-design in `parity/known-broken.ts`.
 * - the row's `type` is derived from the target's declared `BaseType` instead
 *   of being a fourth independent control that could disagree with it.
 * - http's "Status Code" writes `status`, because `status` is the declared
 *   path. It used to write `status_code`, which landed at `body.status_code`
 *   while `{{Http.status}}` stayed hard-coded at 200 (§9.1).
 *
 * **It is drawn as crud's Field Data section, because it is the same thing.**
 * A `Field` whose `actions` slot holds the add control, over a `FieldPanel` of
 * `FieldPanelRow`s, each holding a `VarEditor` — the identical construction as
 * `crud/panel.tsx`'s `renderField`. Plan 24 shipped the chrome but left a bare
 * prompt `Editor` in the row, which reads as a fat textarea beside crud's
 * typed rows and forced `{{` where every other workflow input opens its picker
 * on a single `{`.
 *
 * `VarEditor` is the right control precisely BECAUSE a substitute is not a
 * typed field value: its toggle is the constant/variable distinction the
 * feature already has. Variable mode keeps `{{…}}` refs (a `FieldInputAdapter`
 * could not hold `{{Trigger.count}}` in a `NUMBER` row); constant mode gives
 * the per-type input; and `varEditorText` serialises whichever one back to the
 * string `ErrorDefaultValue.value` has always been.
 *
 * The toggle is UNCONTROLLED, seeded per row from the stored value. The mode
 * is fully recoverable from the value — a substitute either carries a ref or
 * it does not — so persisting it would add a key to `errorDefaultValueSchema`,
 * and therefore to the graph document, to record something already written
 * down.
 */
export function DefaultValuesEditor({
  nodeId,
  declaredOutputs,
  errorHandling,
  values,
  onChange,
  isReadOnly = false,
  description = 'Substitute these outputs and carry on when this node fails',
  footer,
}: DefaultValuesEditorProps) {
  const targets = useMemo(
    () => defaultValueTargets(declaredOutputs, nodeId, errorHandling),
    [declaredOutputs, nodeId, errorHandling]
  )
  const targetByPath = useMemo(() => new Map(targets.map((t) => [t.path, t])), [targets])

  const used = useMemo(() => new Set(values.map((v) => v.key)), [values])
  const available = useMemo(() => targets.filter((t) => !used.has(t.path)), [targets, used])

  const setValue = useCallback(
    (key: string, value: string) =>
      onChange(values.map((row) => (row.key === key ? { ...row, value } : row))),
    [onChange, values]
  )

  const removeRow = useCallback(
    (key: string) => onChange(values.filter((row) => row.key !== key)),
    [onChange, values]
  )

  const addRow = useCallback(
    (path: string) => {
      const target = targetByPath.get(path)
      if (!target) return
      onChange([
        ...values,
        { key: path, type: defaultValueTypeFor(target.variable.type), value: '' },
      ])
    },
    [onChange, targetByPath, values]
  )

  return (
    <Field
      title='Default values'
      description={description}
      actions={
        isReadOnly ? undefined : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={available.length === 0}>
              <Button variant='ghost' size='xs'>
                <Plus />
                Add
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='max-h-72 overflow-y-auto'>
              {available.map((target) => (
                <DropdownMenuItem key={target.path} onSelect={() => addRow(target.path)}>
                  <span className='truncate'>{target.variable.label}</span>
                  <span className='ms-2 truncate text-xs text-muted-foreground'>{target.path}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }>
      <FieldPanel
        orientation='responsive'
        breakpoint='md'
        resizeId='node-default-values'
        className='p-0'>
        {values.length === 0 ? (
          // Not a decorative placeholder: every processor's `default` arm is
          // guarded on a non-empty list and otherwise falls through to `fail`,
          // so an empty editor IS the fail policy (§9.2's warning).
          <div className='px-2 py-1.5 text-sm text-primary-400'>
            No substitutes — this node will fail instead.
          </div>
        ) : (
          values.map((row) => {
            const target = targetByPath.get(row.key)
            return (
              <FieldPanelRow
                // Keyed by the target path, not the array index: index keys
                // remount every row below a deletion and steal focus (§9.7).
                key={row.key}
                title={target?.variable.label ?? row.key}
                description={target?.variable.description}
                type={target?.variable.type ?? BaseType.STRING}
                showIcon
                onClear={isReadOnly ? undefined : () => removeRow(row.key)}
                // A key with no declared target can only be a row persisted
                // before the closed key set. Flag it and let the author remove
                // it — never drop it silently on open, or the config changes
                // underneath them (plan 24 O5).
                validationError={
                  target
                    ? undefined
                    : `"${row.key}" is not one of this node's outputs. Nothing downstream can read it — remove the row.`
                }
                validationType='error'>
                <VarEditor
                  nodeId={nodeId}
                  value={row.value}
                  onChange={(value) => setValue(row.key, varEditorText(value))}
                  varType={constantInputTypeFor(row.type)}
                  allowedTypes={UNFILTERED}
                  defaultIsConstantMode={!containsVariableReference(row.value)}
                  placeholder='Use { for variables'
                  placeholderConstant='Substitute value'
                  readOnly={isReadOnly}
                  hideClearButton
                />
              </FieldPanelRow>
            )
          })
        )}
      </FieldPanel>
      {footer}
    </Field>
  )
}
