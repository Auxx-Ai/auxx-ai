// apps/web/src/components/drawers/blocks/fields-block.tsx
'use client'

// The `fields` block (plans/drawer/record-layout-system.md §4).
//
// Two instances of one thing. With no `fieldGroupId` this is `core:details`:
// the whole-record field panel that today sits hard-coded inside a literal
// `<Section title='Details'>`. With a `fieldGroupId` it is a `fieldGroups[]`
// group PROMOTED out of Details into a standalone section, which is how a
// user-created group becomes placeable on another tab.
//
// Both render the existing `EntityFields` panel over the `contextType: 'panel'`
// field config, so a promoted group keeps every behaviour Details has (inline
// edit, dynamic options, the org field view) rather than growing a second
// renderer that drifts.

import type { FieldsBlockConfig, RecordId } from '@auxx/lib/resources/client'
import { parseRecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import EntityFields from '~/components/fields/entity-fields'
import { useFieldView } from '~/components/fields/hooks/use-field-view'
import { useResourceFields } from '~/components/resources'

export interface FieldsBlockProps {
  /** Block config. Omitted, or with no `fieldGroupId`, means the whole record. */
  config?: FieldsBlockConfig
  /** Full recordId of the record whose fields render. */
  recordId: RecordId
  /** Render every field read-only (restricted drawer mode). */
  readOnly?: boolean
}

/**
 * Renders a record's field panel: the whole record, or one promoted field group.
 *
 * A named group that no longer exists, or one whose every member has been
 * deleted, renders NOTHING. That is deliberate and it is the only interesting
 * case in this component: `EntityFields.includeFields` treats an empty array as
 * "no filter" and would silently render the ENTIRE record in a section labelled
 * with one group's name.
 */
export function FieldsBlock({ config, recordId, readOnly }: FieldsBlockProps) {
  const { entityDefinitionId } = parseRecordId(recordId)
  const { fields } = useResourceFields(entityDefinitionId)
  const { config: viewConfig } = useFieldView({
    entityDefinitionId,
    contextType: 'panel',
    fields,
  })

  const fieldGroupId = config?.fieldGroupId

  /**
   * `fieldGroups[].fieldIds` holds resourceFieldIds, while
   * `EntityFields.includeFields` matches on `field.key`, two different
   * keyspaces, so the group's membership has to be translated rather than
   * passed straight through.
   *
   * `undefined` means "no group named, render everything"; `[]` means "a group
   * was named and resolved to nothing", which the caller turns into no render.
   */
  const includeFields = useMemo((): string[] | undefined => {
    if (!fieldGroupId) return undefined
    const group = viewConfig.fieldGroups?.find((g) => g.id === fieldGroupId)
    if (!group) return []
    const keyByViewId = new Map(
      fields.map((f) => [String(f.resourceFieldId ?? f.id ?? f.key), f.key])
    )
    return group.fieldIds
      .map((id) => keyByViewId.get(id))
      .filter((key): key is string => typeof key === 'string')
  }, [fieldGroupId, viewConfig.fieldGroups, fields])

  if (includeFields && includeFields.length === 0) return null

  return (
    <EntityFields
      recordId={recordId}
      includeFields={includeFields}
      readOnly={readOnly}
      canEdit={!readOnly}
      hideGroupHeaders={Boolean(fieldGroupId)}
    />
  )
}
