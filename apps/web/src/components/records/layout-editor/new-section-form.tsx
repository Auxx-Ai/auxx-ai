// apps/web/src/components/records/layout-editor/new-section-form.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { fieldViewConfigSchema } from '@auxx/lib/conditions/client'
import type { CreatedBlock } from '@auxx/lib/record-layout/client'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { IconPicker } from '@auxx/ui/components/icon-picker'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { useMemo, useState } from 'react'
import { useOrgFieldView } from '~/components/dynamic-table/stores/store-selectors'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useResourceFields } from '~/components/resources'
import { BaseType } from '~/components/workflow/types'

/**
 * Stage 4's two block creators (`plans/drawer/record-layout-system.md` §9.4).
 *
 * Both produce a `CreatedBlock`, the delta's `created` entry, and nothing
 * else. A created block carries no `permissionKey` and no `featureGate`, ever:
 * those are registry facts, and a stored layout that claimed one would be
 * declaring capability rather than placement. A related list is gated on the
 * definition it lists, which the resolver DERIVES from the relationship rather
 * than reading out of the stored config (§7).
 */

/** Which creator the form is showing. */
export type NewSectionKind = 'records' | 'fields'

export interface NewSectionFormProps {
  kind: NewSectionKind
  entityDefinitionId: string
  onCancel: () => void
  onCreate: (block: CreatedBlock) => void
}

interface SourceChoice {
  /** Opaque option id: the field group id, or a relationship's inverse field id. */
  value: string
  label: string
}

/**
 * The relationship fields on the host definition, i.e. every list a related
 * section could show.
 *
 * Creating a `RELATIONSHIP` custom field already auto-creates the inverse field
 * on the target definition, so an org that added "Project → Contact" already has
 * a `contact → Projects` inverse sitting unused. Offering those here is the
 * whole payoff of §4.1: listing one becomes config instead of a shipped
 * component.
 */
function useRelationChoices(entityDefinitionId: string): SourceChoice[] {
  const { fields } = useResourceFields(entityDefinitionId)
  return useMemo(
    () =>
      fields
        .filter((field) => field.fieldType === FieldType.RELATIONSHIP)
        // The option's value IS the inverse field id, which already encodes both
        // halves a `query` source needs: `<target def>:<field pointing back>`.
        // A field with no inverse cannot be listed, because there would be
        // nothing on the target to filter by.
        .flatMap((field) => {
          const inverse = field.relationship?.inverseResourceFieldId
          return inverse ? [{ value: String(inverse), label: field.label }] : []
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [fields]
  )
}

/**
 * The field groups already built on this definition's Details panel, which are
 * the only things a `fields` block can be promoted FROM.
 *
 * Read off the hydrated `panel` view rather than re-queried: the store already
 * holds every context type for the definition, and a second query here would be
 * a waterfall behind a dialog that is already open.
 */
function useFieldGroupChoices(entityDefinitionId: string): SourceChoice[] {
  const panelView = useOrgFieldView(entityDefinitionId, 'panel')
  return useMemo(() => {
    if (!panelView) return []
    const parsed = fieldViewConfigSchema.safeParse(panelView.config)
    if (!parsed.success) return []
    return (parsed.data.fieldGroups ?? []).map((group) => ({
      value: group.id,
      label: group.label,
    }))
  }, [panelView])
}

/**
 * The chosen option id, from whatever the select handed back.
 *
 * Single-select still reports an array (`select-input-field.tsx` calls
 * `onChange(selected: string[])` for both modes), and an empty array is a
 * cleared selection.
 */
export function firstSelected(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

/** The create form for a related list or a promoted field group. */
export function NewSectionForm({
  kind,
  entityDefinitionId,
  onCancel,
  onCreate,
}: NewSectionFormProps) {
  const relations = useRelationChoices(entityDefinitionId)
  const fieldGroups = useFieldGroupChoices(entityDefinitionId)

  const [label, setLabel] = useState('')
  const [icon, setIcon] = useState(kind === 'records' ? 'list' : 'folder')
  const [sourceId, setSourceId] = useState('')

  const choices = kind === 'records' ? relations : fieldGroups
  const chosen = choices.find((choice) => choice.value === sourceId)
  const effectiveLabel = label.trim() || chosen?.label || ''
  const canCreate = sourceId.length > 0 && effectiveLabel.length > 0

  const handleCreate = () => {
    if (!canCreate) return
    const block: CreatedBlock =
      kind === 'records'
        ? {
            kind: 'records',
            label: effectiveLabel,
            icon,
            config: {
              // A `query` source, not `relation`, for two reasons that both bite.
              //
              // `relation` reads the host's inverse MIRROR through
              // `useSystemValues`, which addresses fields by systemAttribute. A
              // CUSTOM relationship has no systemAttribute at all, so the whole
              // §4.1 payoff (list the inverse an org's own definition already
              // created) could never resolve. And the mirror is unordered, so
              // capping it shows an arbitrary five of however many exist.
              //
              // Filtering the TARGET by the field pointing back works for system
              // and custom fields alike, and gives a real order and a page size.
              source: {
                kind: 'query',
                definition: parseResourceFieldId(sourceId as ResourceFieldId).entityDefinitionId,
                hostFieldId: sourceId,
                pageSize: 20,
              },
              visibleLimit: 5,
              emptyLabel: `No ${effectiveLabel.toLowerCase()}`,
            },
          }
        : { kind: 'fields', label: effectiveLabel, icon, config: { fieldGroupId: sourceId } }
    onCreate(block)
  }

  const emptyPlaceholder =
    kind === 'records'
      ? 'This definition has no relationships yet'
      : 'This definition has no field groups yet'

  return (
    // `DialogContent` runs `innerClassName='p-0'`, so the CONTENT is inset here
    // and the footer is left flush for `DialogNavPages`' own `footerGutter`.
    //
    // The gutter goes on this wrapper, never on the `FieldPanel`: the panel is a
    // bordered, tinted card that already carries its own internal `px-1.5
    // py-0.5`, so a `p-3` on it overrides that gutter and inflates the inside of
    // the card while the card itself still sits flush against the dialog edge.
    // `intake-header-panel.tsx` and `create-bill-from-purchase-order-dialog.tsx`
    // both pad from outside for the same reason.
    //
    // No bottom gutter: `DialogFooter` already carries `pt-4`, so one here would
    // stack with it and leave a gap under the panel.
    <div className='flex flex-col'>
      <div className='px-3 pt-3'>
        <FieldPanel orientation='responsive' breakpoint='md' resizeId='record-layout-new-section'>
          <FieldPanelRow
            title={kind === 'records' ? 'Related records' : 'Field group'}
            type={BaseType.STRING}
            showIcon
            isRequired>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{
                options: choices.map((choice) => ({
                  id: choice.value,
                  value: choice.value,
                  label: choice.label,
                })),
              }}
              value={sourceId || null}
              // The picker hands back a `string[]` even in single-select mode, so
              // a `typeof value === 'string'` guard silently discarded every pick
              // and the trigger never showed a selection. Unwrapping at the call
              // site is the convention here (see `intake-header-panel.tsx`).
              onChange={(value) => setSourceId(firstSelected(value))}
              // The standard trigger shape for a picker inside a `FieldPanelRow`:
              // the row already owns the leading gutter, so the trigger drops its
              // own start padding and fills the value column.
              triggerProps={{ className: 'ps-0 pe-1 w-full' }}
              placeholder={choices.length === 0 ? emptyPlaceholder : 'Choose one'}
              disabled={choices.length === 0}
              canAdd={false}
              canManage={false}
            />
          </FieldPanelRow>

          {/* Icon and title share one row, the shape `dashboard-form.tsx` uses:
              the icon is an attribute OF the name, not a field of its own, and a
              dedicated row made it read like a third thing to fill in. */}
          <FieldPanelRow title='Section title' type={BaseType.STRING} showIcon isLastRow>
            <div className='flex items-center gap-2'>
              <IconPicker
                value={{ icon, color: 'gray' }}
                onChange={(value) => setIcon(value.icon)}
                align='start'
                modal={false}
                hideColors>
                <button type='button' aria-label='Pick an icon for this section'>
                  <EntityIcon iconId={icon} color='gray' className='size-8! rounded-md border' />
                </button>
              </IconPicker>
              <div className='min-w-0 flex-1'>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={label}
                  onChange={(value) => setLabel(typeof value === 'string' ? value : '')}
                  placeholder={chosen?.label ?? 'Section title'}
                />
              </div>
            </div>
          </FieldPanelRow>
        </FieldPanel>
      </div>

      <DialogFooter>
        <Button type='button' variant='ghost' size='sm' onClick={onCancel}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={!canCreate}
          onClick={handleCreate}
          data-dialog-submit>
          Add section <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </div>
  )
}
