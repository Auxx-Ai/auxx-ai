// apps/web/src/components/custom-fields/ui/entity-appearance-editor.tsx
'use client'

import { api } from '~/trpc/react'
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

/** Props for EntityAppearanceEditor */
interface EntityAppearanceEditorProps {
  entityDefinitionId: string
  icon: string | null
  color: string | null
  singular: string
  plural: string
  primaryDisplayFieldId: string | null
  secondaryDisplayFieldId: string | null
  avatarFieldId: string | null
  onUpdate?: () => void
}

/** Editor for entity appearance settings (display fields) */
export function EntityAppearanceEditor({
  entityDefinitionId,
  icon,
  color,
  singular,
  plural,
  primaryDisplayFieldId,
  secondaryDisplayFieldId,
  avatarFieldId,
  onUpdate,
}: EntityAppearanceEditorProps) {
  // Fetch custom fields for this entity
  const { data: customFields } = api.customField.getByEntityDefinition.useQuery({
    entityDefinitionId,
  })

  // Update mutation
  const { updateEntity } = useEntityDefinitionMutations()

  /** Handle display field change */
  const handleChange = (
    field: 'primaryDisplayFieldId' | 'secondaryDisplayFieldId' | 'avatarFieldId',
    value: string | null
  ) => {
    updateEntity.mutate(
      { id: entityDefinitionId, data: { [field]: value } },
      { onSuccess: () => onUpdate?.() }
    )
  }

  // Get display values for preview
  const primaryField = customFields?.find((f) => f.id === primaryDisplayFieldId)
  const secondaryField = customFields?.find((f) => f.id === secondaryDisplayFieldId)

  return (
    <div className="p-4 border-b">
      <h3 className="flex items-center gap-2 tracking-tight font-semibold text-foreground text-base mb-4">
        <Palette className="size-4" />
        Appearance
      </h3>

      <div className="grid grid-cols-2 gap-6">
        {/* Left column: Select fields */}
        <div>
          <VarEditorField className="p-0">
            <VarEditorFieldRow
              title="Display Field"
              description="Shown as the main name in pickers">
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
                    ?.filter((f) =>
                      ['TEXT', 'EMAIL', 'NAME', 'PHONE', 'PHONE_INTL', 'URL', 'NUMBER'].includes(
                        f.type
                      )
                    )
                    .map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </VarEditorFieldRow>
            <VarEditorFieldRow
              title="Subtitle Field"
              description="Optional subtitle below the name">
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
                  {customFields?.map((field) => (
                    <SelectItem key={field.id} value={field.id}>
                      {field.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </VarEditorFieldRow>
            <VarEditorFieldRow title="Avatar Field" description="Image field for avatar">
              <Select
                value={avatarFieldId ?? 'none'}
                onValueChange={(v) => handleChange('avatarFieldId', v === 'none' ? null : v)}>
                <SelectTrigger variant="transparent" size="sm">
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {customFields
                    ?.filter((f) => f.type === 'URL' || f.type === 'FILE')
                    .map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </VarEditorFieldRow>
          </VarEditorField>
        </div>

        {/* Right column: Preview */}
        <div className="flex items-center justify-center border rounded-2xl p-4 bg-muted">
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
