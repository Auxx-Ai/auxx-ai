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
import { useCallback, useMemo } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { Editor } from '~/components/workflow/ui/prompt-editor'

/** The `BaseType`s whose substitutes are written as JSON rather than plain text. */
const JSON_TYPES = new Set<BaseType>([BaseType.OBJECT, BaseType.ARRAY])

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

interface DefaultValuesEditorProps {
  /** Canvas node id — the `{{…}}` picker needs it, and target paths are relative to it. */
  nodeId: string
  /** What the node's `resolveOutputs` returned. Targets are derived from this. */
  declaredOutputs: UnifiedVariable[]
  /** The manifest's declaration, for `defaultValueExclude`. */
  errorHandling: NodeErrorHandling | undefined
  values: ErrorDefaultValue[]
  onChange: (values: ErrorDefaultValue[]) => void
  isReadOnly?: boolean
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
 * **Why the value input is an `Editor` and not a `FieldInputAdapter`.**
 * `docs/ui-design-guide.md` §5 says every input inside a `FieldPanelRow` goes
 * through the adapter, and that rule is right for typed field values. A
 * substitute is not one: it is persisted as a STRING that may carry `{{…}}`
 * refs and is coerced to the target's type at run time
 * (`coerceDefaultValue`). A `NUMBER` adapter cannot hold `{{Trigger.count}}`,
 * so an adapter here would remove a capability the runtime already has — both
 * processors interpolate. The row still uses `FieldPanel`/`FieldPanelRow` for
 * its chrome, and the declared `BaseType` drives the row icon so the author
 * can see what they are writing into. `message-received/panel.tsx` is the
 * precedent for a non-adapter input inside a workflow `FieldPanelRow`.
 */
export function DefaultValuesEditor({
  nodeId,
  declaredOutputs,
  errorHandling,
  values,
  onChange,
  isReadOnly = false,
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
    <div className='space-y-2'>
      {values.length > 0 && (
        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='node-default-values'
          className='p-0'>
          {values.map((row) => {
            const target = targetByPath.get(row.key)
            return (
              <FieldPanelRow
                // Keyed by the target path, not the array index: index keys
                // remount every row below a deletion and steal focus (§9.7).
                key={row.key}
                title={target?.variable.label ?? row.key}
                description={target?.variable.description}
                type={target?.variable.type}
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
                <Editor
                  value={row.value}
                  onChange={(value) => setValue(row.key, value)}
                  nodeId={nodeId}
                  trigger='{{'
                  readOnly={isReadOnly}
                  compact={!JSON_TYPES.has(target?.variable.type ?? BaseType.STRING)}
                  minHeight={JSON_TYPES.has(target?.variable.type ?? BaseType.STRING) ? 80 : 32}
                  placeholder={
                    JSON_TYPES.has(target?.variable.type ?? BaseType.STRING)
                      ? 'JSON, or {{variables}}…'
                      : 'Substitute value, or {{variables}}…'
                  }
                />
              </FieldPanelRow>
            )
          })}
        </FieldPanel>
      )}

      {!isReadOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={available.length === 0}>
            <Button variant='ghost' size='sm' className='w-full text-xs'>
              <Plus />
              {available.length === 0 ? 'All outputs have defaults' : 'Add default value'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='max-h-72 overflow-y-auto'>
            {available.map((target) => (
              <DropdownMenuItem key={target.path} onSelect={() => addRow(target.path)}>
                <span className='truncate'>{target.variable.label}</span>
                <span className='ms-2 truncate text-xs text-muted-foreground'>{target.path}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
