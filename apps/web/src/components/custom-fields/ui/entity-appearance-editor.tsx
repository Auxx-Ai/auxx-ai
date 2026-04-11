// apps/web/src/components/custom-fields/ui/entity-appearance-editor.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { PRIMARY_DISPLAY_ELIGIBLE_TYPES } from '@auxx/lib/custom-fields/client'
import type { Resource } from '@auxx/lib/resources/client'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { AlertTriangle, Check, Palette } from 'lucide-react'
import { useEntityDefinitionMutations } from '~/components/resources/hooks'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'

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
  // For dropdown options, show all active fields (template entities have system fields that should still be selectable)
  const selectableFields = allFields.filter((f) => f.active !== false)

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

  // Compute avatar field warnings for FILE fields
  const avatarWarnings: string[] = []
  if (avatarField?.fieldType === 'FILE') {
    const fileOpts = (avatarField.options as Record<string, any>)?.file
    if (fileOpts?.allowMultiple || (fileOpts?.maxFiles && fileOpts.maxFiles > 1)) {
      avatarWarnings.push('Only the first file will be used as the avatar')
    }
    // allowedFileTypes stores categories like 'image', 'document', 'video', 'audio', 'custom'
    const allowed = fileOpts?.allowedFileTypes as string[] | undefined
    if (!allowed || allowed.length === 0) {
      avatarWarnings.push(
        'This field has no file type restrictions — non-image files will be ignored'
      )
    } else if (!allowed.includes('image')) {
      avatarWarnings.push(
        'This field does not allow image file types — no avatars will be generated'
      )
    } else if (allowed.length > 1) {
      avatarWarnings.push(
        'This field allows non-image file types — only images will generate avatars'
      )
    }
  }

  return (
    <div className='p-4 border-b'>
      <h3 className='flex items-center gap-2 tracking-tight font-semibold text-foreground text-base mb-4'>
        <Palette className='size-4' />
        Appearance
      </h3>

      {disabled && (
        <div className='text-xs text-muted-foreground italic mb-4'>
          System entities cannot be customized. Display fields are predefined.
        </div>
      )}

      <div className='grid grid-cols-2 gap-6'>
        {/* Left column: Select fields */}
        <div>
          <VarEditorField className='p-0 dark:bg-primary-50'>
            <VarEditorFieldRow
              title='Display Field'
              description='Shown as the main name in pickers'>
              {disabled ? (
                <span className='text-sm text-muted-foreground h-7.5 flex items-center'>
                  {primaryField?.name ?? 'None'}
                </span>
              ) : (
                <Select
                  value={primaryDisplayFieldId ?? 'none'}
                  onValueChange={(v) =>
                    handleChange('primaryDisplayFieldId', v === 'none' ? null : v)
                  }>
                  <SelectTrigger variant='transparent' size='sm'>
                    <SelectValue placeholder='Select field' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='none'>None</SelectItem>
                    {selectableFields
                      .filter(
                        (f) =>
                          f.fieldType &&
                          PRIMARY_DISPLAY_ELIGIBLE_TYPES.includes(f.fieldType as FieldType)
                      )
                      .map((field) => (
                        <SelectItem key={field.id} value={field.id}>
                          {field.name ?? field.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </VarEditorFieldRow>
            <VarEditorFieldRow
              title='Subtitle Field'
              description='Optional subtitle below the name'>
              {disabled ? (
                <span className='text-sm text-muted-foreground h-7.5 flex items-center'>
                  {secondaryField?.name ?? secondaryField?.label ?? 'None'}
                </span>
              ) : (
                <Select
                  value={secondaryDisplayFieldId ?? 'none'}
                  onValueChange={(v) =>
                    handleChange('secondaryDisplayFieldId', v === 'none' ? null : v)
                  }>
                  <SelectTrigger variant='transparent' size='sm'>
                    <SelectValue placeholder='Select field' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='none'>None</SelectItem>
                    {selectableFields.map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.name ?? field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </VarEditorFieldRow>
            <VarEditorFieldRow title='Avatar Field' description='Image field for avatar'>
              {disabled ? (
                <span className='text-sm text-muted-foreground h-7.5 flex items-center'>
                  {avatarField?.name ?? avatarField?.label ?? 'None'}
                </span>
              ) : (
                <Select
                  value={avatarFieldId ?? 'none'}
                  onValueChange={(v) => handleChange('avatarFieldId', v === 'none' ? null : v)}>
                  <SelectTrigger variant='transparent' size='sm'>
                    <SelectValue placeholder='Select field' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='none'>None</SelectItem>
                    {selectableFields
                      .filter((f) => f.fieldType === 'URL' || f.fieldType === 'FILE')
                      .map((field) => (
                        <SelectItem key={field.id} value={field.id}>
                          {field.name ?? field.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </VarEditorFieldRow>
            {avatarWarnings.length > 0 && (
              <div className='flex gap-2 px-3 py-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-md mx-2 mb-2'>
                <AlertTriangle className='size-3.5 shrink-0 mt-0.5' />
                <div className='space-y-0.5'>
                  {avatarWarnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              </div>
            )}
          </VarEditorField>
        </div>

        {/* Right column: Preview */}
        <div className='flex items-center justify-center border rounded-2xl p-4 bg-muted dark:bg-primary-50 min-h-[120px]'>
          <div className='max-w-[300px] w-full'>
            <div className='flex items-center gap-2 rounded-2xl border bg-background py-2 ps-1 pe-2'>
              <Avatar className='size-6'>
                <AvatarFallback className='text-xs'>
                  {(primaryField?.name || singular || 'D')[0]}
                </AvatarFallback>
              </Avatar>
              <div className='flex flex-1 flex-col'>
                <span className='truncate text-sm'>
                  {primaryField?.name || singular || 'Display Name'}
                </span>
                {secondaryField && (
                  <span className='text-xs text-muted-foreground'>{secondaryField.name}</span>
                )}
              </div>
              <Check className='size-4 opacity-100' />
            </div>
            <p className='text-xs text-muted-foreground mt-2 text-center'>Preview</p>
          </div>
        </div>
      </div>
    </div>
  )
}
