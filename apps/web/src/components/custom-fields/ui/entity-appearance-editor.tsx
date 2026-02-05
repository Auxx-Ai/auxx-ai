// apps/web/src/components/custom-fields/ui/entity-appearance-editor.tsx
'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { useEntityDefinitionMutations } from '~/components/resources/hooks'
import { Palette, Check } from 'lucide-react'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import type { Resource } from '@auxx/lib/resources/client'
import { PRIMARY_DISPLAY_ELIGIBLE_TYPES } from '@auxx/lib/custom-fields/client'
import type { FieldType } from '@auxx/database/types'

/** Props for EntityAppearanceEditor */
interface EntityAppearanceEditorProps {
  /** Resource (system or custom) */
  resource: Resource
  /** Disable editing (for system resources) */
  disabled?: boolean
  /** Callback after successful update */
  onUpdate?: () => void
}

/** Editor for entity appearance settings (display fields) */
export function EntityAppearanceEditor({
  resource,
  disabled = false,
  onUpdate,
}: EntityAppearanceEditorProps) {
  // Extract values from resource
  const { entityDefinitionId, label: singular } = resource

  // Get display field IDs from resource (works for both system and custom)
  const primaryDisplayFieldId = resource.display.primaryDisplayField?.id ?? null
  const secondaryDisplayFieldId = resource.display.secondaryDisplayField?.id ?? null
  const avatarFieldId = resource.display.avatarField?.id ?? null

  // All fields for looking up display field names (includes system fields)
  const allFields = resource.fields
  // For dropdown options, only show custom fields (system fields can't be changed)
  const customFields = allFields.filter((f) => !f.isSystem)

  // Update mutation
  const { updateEntity } = useEntityDefinitionMutations()

  /** Handle display field change */
  const handleChange = (
    field: 'primaryDisplayFieldId' | 'secondaryDisplayFieldId' | 'avatarFieldId',
    value: string | null
  ) => {
    if (disabled) return
    updateEntity.mutate(
      { id: entityDefinitionId, data: { [field]: value } },
      { onSuccess: () => onUpdate?.() }
    )
  }

  // Get display values for preview (look in all fields, not just custom)
  const primaryField = allFields.find((f) => f.id === primaryDisplayFieldId)
  const secondaryField = allFields.find((f) => f.id === secondaryDisplayFieldId)
  const avatarField = allFields.find((f) => f.id === avatarFieldId)

  return (
    <div className="p-4 border-b">
      <h3 className="flex items-center gap-2 tracking-tight font-semibold text-foreground text-base mb-4">
        <Palette className="size-4" />
        Appearance
      </h3>

      {disabled && (
        <div className="text-xs text-muted-foreground italic mb-4">
          System entities cannot be customized. Display fields are predefined.
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Left column: Select fields */}
        <div>
          <VarEditorField className="p-0">
            <VarEditorFieldRow
              title="Display Field"
              description="Shown as the main name in pickers">
              {disabled ? (
                <span className="text-sm text-muted-foreground h-7.5 flex items-center">
                  {primaryField?.name ?? 'None'}
                </span>
              ) : (
                <Select
                  value={primaryDisplayFieldId ?? 'none'}
                  onValueChange={(v) =>
                    handleChange('primaryDisplayFieldId', v === 'none' ? null : v)
                  }>
                  <SelectTrigger variant="transparent" size="sm">
                    <SelectValue placeholder="Select field" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {customFields
                      .filter(
                        (f) =>
                          f.fieldType &&
                          PRIMARY_DISPLAY_ELIGIBLE_TYPES.includes(f.fieldType as FieldType)
                      )
                      .map((field) => (
                        <SelectItem key={field.id} value={field.id}>
                          {field.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </VarEditorFieldRow>
            <VarEditorFieldRow
              title="Subtitle Field"
              description="Optional subtitle below the name">
              {disabled ? (
                <span className="text-sm text-muted-foreground h-7.5 flex items-center">
                  {secondaryField?.name ?? 'None'}
                </span>
              ) : (
                <Select
                  value={secondaryDisplayFieldId ?? 'none'}
                  onValueChange={(v) =>
                    handleChange('secondaryDisplayFieldId', v === 'none' ? null : v)
                  }>
                  <SelectTrigger variant="transparent" size="sm">
                    <SelectValue placeholder="Select field" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {customFields.map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </VarEditorFieldRow>
            <VarEditorFieldRow title="Avatar Field" description="Image field for avatar">
              {disabled ? (
                <span className="text-sm text-muted-foreground h-7.5 flex items-center">
                  {avatarField?.name ?? 'None'}
                </span>
              ) : (
                <Select
                  value={avatarFieldId ?? 'none'}
                  onValueChange={(v) => handleChange('avatarFieldId', v === 'none' ? null : v)}>
                  <SelectTrigger variant="transparent" size="sm">
                    <SelectValue placeholder="Select field" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {customFields
                      .filter((f) => f.fieldType === 'URL' || f.fieldType === 'FILE')
                      .map((field) => (
                        <SelectItem key={field.id} value={field.id}>
                          {field.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </VarEditorFieldRow>
          </VarEditorField>
        </div>

        {/* Right column: Preview */}
        <div className="flex items-center justify-center border rounded-2xl p-4 bg-muted min-h-[120px]">
          <div className="max-w-[300px] w-full">
            <div className="flex items-center gap-2 rounded-2xl border bg-background py-2 ps-1 pe-2">
              <Avatar className="size-6">
                <AvatarFallback className="text-xs">
                  {(primaryField?.name || singular || 'D')[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-1 flex-col">
                <span className="truncate text-sm">
                  {primaryField?.name || singular || 'Display Name'}
                </span>
                {secondaryField && (
                  <span className="text-xs text-muted-foreground">{secondaryField.name}</span>
                )}
              </div>
              <Check className="size-4 opacity-100" />
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">Preview</p>
          </div>
        </div>
      </div>
    </div>
  )
}
