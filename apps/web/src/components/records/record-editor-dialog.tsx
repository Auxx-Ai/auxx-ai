// apps/web/src/components/records/record-editor-dialog.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import { WorkOrderEditorDialog } from '~/components/dispatch/ui/work-order-editor'
import { PartFormDialog } from '~/components/manufacturing/parts/part-form-dialog'
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
  /** Preset field values for CREATE mode. Custom editors may ignore this. */
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
  part: PartEditorAdapter,
  work_order: WorkOrderEditorAdapter,
}

function WorkOrderEditorAdapter(props: RecordEditorDialogProps) {
  return <WorkOrderEditorDialog {...props} />
}

/** Adapts {@link PartFormDialog} (uses `onSuccess`, no def id / presets) to the shared shape. */
function PartEditorAdapter({ open, onOpenChange, recordId, onSaved }: RecordEditorDialogProps) {
  return (
    <PartFormDialog
      open={open}
      onOpenChange={onOpenChange}
      recordId={recordId}
      onSuccess={() => onSaved?.()}
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
