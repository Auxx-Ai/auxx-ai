// apps/web/src/components/records/record-editor-dialog.tsx
'use client'

import { getInstanceId, isRecordId, type RecordId } from '@auxx/lib/resources/client'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import { WorkOrderEditorDialog } from '~/components/dispatch/ui/work-order-editor'
import { BuildFormDialog } from '~/components/manufacturing/builds/build-form-dialog'
import { PartFormDialog } from '~/components/manufacturing/parts/part-form-dialog'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useResource } from '~/components/resources/hooks/use-resource'

/**
 * Normalized props every record editor (generic or custom) accepts, so callers
 * never care which concrete dialog resolves for a given entity type.
 */
export interface RecordEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Entity definition ID of the record being created/edited. */
  entityDefinitionId: string
  /** RecordId for edit mode; undefined for create. */
  recordId?: RecordId
  /** Called after a successful save. */
  onSaved?: (instanceId?: string) => void
  /**
   * Preset field values for CREATE mode, **keyed by field id** — the shape
   * `EntityInstanceForm` applies (`initValues[fieldId] = value`, keys compared
   * against `editableFields[].id`), not by systemAttribute. Custom editors
   * translate the keys they understand and ignore the rest.
   */
  presetValues?: Record<string, unknown>
}

/**
 * Registry of entity types whose editor is a bespoke dialog rather than the
 * generic {@link EntityInstanceDialog}. Keyed by `resource.entityType` (the
 * stable system enum, e.g. `'part'`). Anything not listed falls through to the
 * generic form. Adapters normalize each dialog's props onto
 * {@link RecordEditorDialogProps}.
 */
const CUSTOM_EDITORS: Record<string, React.ComponentType<RecordEditorDialogProps>> = {
  build: BuildEditorAdapter,
  part: PartEditorAdapter,
  work_order: WorkOrderEditorAdapter,
}

function WorkOrderEditorAdapter(props: RecordEditorDialogProps) {
  return <WorkOrderEditorDialog {...props} />
}

/**
 * Routes "New build" through `builds.create`
 * (plans/money/tasks/23-build-from-the-part.md §5).
 *
 * 🛑 **CREATE only.** `createBuild` makes two validations nothing else enforces
 * — the part must not be classified as purchased, and it must have at least one
 * direct subpart — and until this adapter existed the generic dialog reached
 * `record.create` and skipped both. Editing a build is a different question:
 * `build_status` is `showInDialogs: false` and every transition is a procedure
 * with its own preconditions, so an edit falls through to the generic form
 * rather than to a bespoke one that would have to reimplement the panel.
 */
function BuildEditorAdapter(props: RecordEditorDialogProps) {
  const partField = useSystemField('build_part', props.entityDefinitionId)
  const partId = presetInstanceId(props.presetValues, partField?.id)

  if (props.recordId) return <EntityInstanceDialog {...props} />

  return (
    <BuildFormDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      partId={partId}
      onSuccess={(buildId) => props.onSaved?.(buildId)}
    />
  )
}

/**
 * Read one RELATIONSHIP preset out of the field-id-keyed preset map and unwrap
 * it to a bare EntityInstance id.
 *
 * Pure so the translation is testable without a resource store: the only thing
 * the component contributes is resolving `fieldId`. Handles both stored shapes
 * — a RELATIONSHIP value arrives as `RecordId[]` on most read paths and as a
 * scalar on others, and either half may be a bare instance id rather than a
 * `RecordId`.
 */
export function presetInstanceId(
  presetValues: Record<string, unknown> | undefined,
  fieldId: string | undefined
): string | undefined {
  if (!presetValues || !fieldId) return undefined
  const raw = presetValues[fieldId]
  const first = Array.isArray(raw) ? raw[0] : raw
  if (typeof first !== 'string' || first === '') return undefined
  return isRecordId(first) ? getInstanceId(first) : first
}

/**
 * Adapts {@link PartFormDialog} (which uses `onSuccess` and an explicit
 * `productId`) to the shared shape.
 *
 * `presetValues` used to be dropped here, which made the generic contract lie:
 * a caller passed presets, `RecordEditorDialog` accepted them, and for `part`
 * alone they vanished with no error. The map is keyed by FIELD ID, so the
 * part's `product` field id is resolved first and used to read it — forward
 * resolution only, no inverse map. Only `part_product` is translated today;
 * that is the one preset a caller has a reason to pass (creating a variant into
 * a family), and an unknown key is ignored rather than crashing.
 */
function PartEditorAdapter({
  open,
  onOpenChange,
  entityDefinitionId,
  recordId,
  onSaved,
  presetValues,
}: RecordEditorDialogProps) {
  const productField = useSystemField('part_product', entityDefinitionId)
  const productId = presetInstanceId(presetValues, productField?.id)

  return (
    <PartFormDialog
      open={open}
      onOpenChange={onOpenChange}
      recordId={recordId}
      productId={productId}
      onSuccess={(instanceId) => onSaved?.(instanceId)}
    />
  )
}

/**
 * Single entry point for opening a record's create/edit dialog from anywhere.
 * Resolves the entity type from the resource store and renders that type's
 * custom editor when one is registered, otherwise the generic form. Use this
 * instead of reaching for `EntityInstanceDialog` directly so custom editors
 * (e.g. Parts) can't be bypassed.
 */
export function RecordEditorDialog(props: RecordEditorDialogProps) {
  const { resource } = useResource(props.entityDefinitionId)
  const Custom = resource?.entityType ? CUSTOM_EDITORS[resource.entityType] : undefined

  if (Custom) return <Custom {...props} />
  return <EntityInstanceDialog {...props} />
}
