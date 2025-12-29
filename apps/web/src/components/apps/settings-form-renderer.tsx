// apps/web/src/components/apps/settings-form-renderer.tsx
'use client'

import { useForm, Controller } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { schemaToZod, type SettingsSchemaField } from '@auxx/services/app-settings/client'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Card } from '@auxx/ui/components/card'
import { Button } from '@auxx/ui/components/button'
import { useMemo } from 'react'

/**
 * Props for SettingsFormRenderer component
 */
interface SettingsFormRendererProps {
  schema: Record<string, SettingsSchemaField>
  defaultValues: Record<string, any>
  onSubmit: (values: Record<string, any>) => void | Promise<void>
  isPending?: boolean
}

/**
 * SettingsFormRenderer component
 * Renders a form from settings schema with Zod validation via react-hook-form
 */
export function SettingsFormRenderer({
  schema,
  defaultValues,
  onSubmit,
  isPending,
}: SettingsFormRendererProps) {
  // Convert SDK schema to Zod schema
  const zodSchema = useMemo(() => {
    try {
      return schemaToZod(schema)
    } catch (err) {
      console.error('Failed to convert schema to Zod:', err)
      return null
    }
  }, [schema])

  const form = useForm({
    resolver: zodSchema ? standardSchemaResolver(zodSchema) : undefined,
    defaultValues,
    mode: 'onBlur', // Validate on blur for better UX
  })

  /**
   * Wrapped submit handler that resets form state after successful save
   */
  const handleSubmit = async (values: Record<string, any>) => {
    await onSubmit(values)
    // Reset form with new values to clear isDirty and update defaults
    form.reset(values)
  }

  if (!zodSchema) {
    return (
      <div className="text-center py-8 text-destructive">
        <p>Error: Invalid settings schema</p>
      </div>
    )
  }

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)}>
      <div className="p-6 pb-2 space-y-6">
        {Object.entries(schema).map(([key, field]) => (
          <SettingField
            key={key}
            path={key}
            field={field}
            control={form.control}
            error={form.formState.errors[key]}
          />
        ))}
      </div>

      {/* Form actions - only show when form has changes */}
      {form.formState.isDirty && (
        <div className="sticky py-2 px-4 bottom-0 flex justify-end gap-3  border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => form.reset()}
            disabled={isPending}>
            Reset
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="default"
            loading={isPending}
            loadingText="Saving...">
            Save Settings
          </Button>
        </div>
      )}
    </form>
  )
}

/**
 * Props for SettingField component
 */
interface SettingFieldProps {
  path: string
  field: SettingsSchemaField
  control: any
  error: any
}

/**
 * SettingField component
 * Renders a single settings field (primitive or struct)
 */
function SettingField({ path, field, control, error }: SettingFieldProps) {
  const label = field._metadata?.label || path
  const description = field._metadata?.description

  // Handle struct (nested group)
  if (field.type === 'struct' && field.fields) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold">{label}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <div className="space-y-4 pt-2">
          {Object.entries(field.fields).map(([nestedKey, nestedField]) => (
            <SettingField
              key={nestedKey}
              path={`${path}.${nestedKey}`}
              field={nestedField}
              control={control}
              error={error?.[nestedKey]}
            />
          ))}
        </div>
      </Card>
    )
  }

  // Render primitive fields with Controller
  return (
    <div className="space-y-2">
      <Label htmlFor={path}>
        {label}
        {field.is_optional && <span className="text-muted-foreground ml-1">(optional)</span>}
      </Label>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}

      <Controller
        name={path}
        control={control}
        render={({ field: controllerField }) => renderInput(path, field, controllerField)}
      />

      {/* Display validation error */}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </div>
  )
}

/**
 * Render input component based on field type
 *
 * @param path - Field path (for id)
 * @param field - Field schema
 * @param controllerField - React Hook Form controller field
 * @returns React component for input
 */
function renderInput(path: string, field: SettingsSchemaField, controllerField: any) {
  const metadata = field._metadata

  switch (field.type) {
    case 'boolean':
      return (
        <div className="w-full">
          <Switch
            id={path}
            checked={controllerField.value ?? false}
            onCheckedChange={controllerField.onChange}
            onBlur={controllerField.onBlur}
          />
        </div>
      )

    case 'number':
      return (
        <Input
          id={path}
          type="number"
          value={controllerField.value ?? ''}
          onChange={(e) => {
            const val = e.target.value
            controllerField.onChange(val === '' ? undefined : parseFloat(val))
          }}
          onBlur={controllerField.onBlur}
          min={metadata?.min}
          max={metadata?.max}
          step={metadata?.step}
          placeholder={metadata?.placeholder}
        />
      )

    case 'select':
      return (
        <Select value={controllerField.value ?? ''} onValueChange={controllerField.onChange}>
          <SelectTrigger id={path}>
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            {metadata?.options?.map((option: string) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )

    case 'string':
    default:
      return (
        <Input
          id={path}
          type="text"
          value={controllerField.value ?? ''}
          onChange={controllerField.onChange}
          onBlur={controllerField.onBlur}
          minLength={metadata?.minLength}
          maxLength={metadata?.maxLength}
          placeholder={metadata?.placeholder}
        />
      )
  }
}
