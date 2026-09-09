// apps/build/src/app/(portal)/[slug]/apps/[app_slug]/connections/connection-variable-dialog.tsx
'use client'

import type { ConnectionVariable, ConnectionVariableOption } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { Field, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { TooltipExplanation } from '@auxx/ui/components/tooltip'
import { Edit2, Lock, Plus, Trash2, Variable, X } from 'lucide-react'
import { useState } from 'react'
import { toastError } from '~/components/global/toast'
import { ConnectionVariableOptionsEditor } from './connection-variable-options-editor'

/** Validation constraints as edited here: the `validation` bag of a `ConnectionVariable`. */
type VariableValidation = NonNullable<ConnectionVariable['validation']>

/**
 * The four platform field types a connection variable may carry. Masking is the `secret`
 * flag and multiline is the `multiline` flag, neither is a type. An absent `type` means
 * TEXT, which is why TEXT is never written to the row.
 */
const VARIABLE_TYPES = [
  { value: FieldType.TEXT, label: 'Text' },
  { value: FieldType.NUMBER, label: 'Number' },
  { value: FieldType.CHECKBOX, label: 'Checkbox' },
  { value: FieldType.SINGLE_SELECT, label: 'Single select' },
] as const

/** The four `FieldType` members a connection variable may carry. */
export type ConnectionVariableType = (typeof VARIABLE_TYPES)[number]['value']

type VariableType = ConnectionVariableType

/**
 * A `ConnectionVariable` as the developer portal authors it: identical to the stored shape
 * except `type` is narrowed to the four renderable types, matching the router's `z.enum`.
 */
export type PortalConnectionVariable = Omit<ConnectionVariable, 'type'> & {
  type?: ConnectionVariableType
}

/**
 * Narrow stored variables to the portal's authorable shape. A `type` outside the four
 * renderable members is out of contract (see `ConnectionVariable`'s doc comment) and is
 * dropped, which every renderer reads as TEXT.
 */
export function toPortalVariables(variables: ConnectionVariable[]): PortalConnectionVariable[] {
  return variables.map(({ type, ...rest }) => {
    const authorable = VARIABLE_TYPES.find((t) => t.value === type)
    return authorable ? { ...rest, type: authorable.value } : rest
  })
}

/** Empty form state for a brand-new variable (a plain required TEXT input). */
function emptyVariable(): PortalConnectionVariable {
  return {
    key: '',
    label: '',
    description: '',
    placeholder: '',
    required: true,
    secret: false,
    type: FieldType.TEXT,
  }
}

/** Parse a numeric input back to a number, treating a blank box as "no constraint". */
function toNumberOrUndefined(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Render a numeric constraint for its input, blank when unset. */
function numberInputValue(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

/**
 * Keep only the constraints that mean something for `type`, and drop the bag entirely
 * when nothing is left, so a variable with no rules serialises without a `validation` key.
 */
function cleanValidation(
  type: VariableType,
  validation: VariableValidation | undefined
): VariableValidation | undefined {
  if (!validation) return undefined
  const cleaned: VariableValidation = {}

  if (type === FieldType.TEXT) {
    if (validation.minLength !== undefined) cleaned.minLength = validation.minLength
    if (validation.maxLength !== undefined) cleaned.maxLength = validation.maxLength
    const pattern = validation.pattern?.trim()
    if (pattern) {
      cleaned.pattern = pattern
      const message = validation.message?.trim()
      if (message) cleaned.message = message
    }
  }

  if (type === FieldType.NUMBER) {
    // `port` is a complete range on its own (1-65535), so it replaces min/max rather
    // than stacking with them, which is also why the form disables those inputs.
    if (validation.port) {
      cleaned.port = true
    } else {
      if (validation.min !== undefined) cleaned.min = validation.min
      if (validation.max !== undefined) cleaned.max = validation.max
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

/** Trim a select's choices and drop rows the author left completely blank. */
function cleanOptions(options: ConnectionVariableOption[] | undefined) {
  return (options ?? [])
    .map((opt) => ({
      ...(opt.id ? { id: opt.id } : {}),
      label: opt.label.trim(),
      value: opt.value.trim(),
    }))
    .filter((opt) => opt.label || opt.value)
    .map((opt) => ({ ...opt, label: opt.label || opt.value }))
}

/** Variable definition item row */
function VariableDefinitionItem({
  variable,
  onEdit,
  onDelete,
}: {
  variable: PortalConnectionVariable
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className='group flex items-center gap-3 rounded-xl border px-3 py-2 hover:bg-muted/50 transition-colors'>
      <code className='text-sm font-mono text-muted-foreground'>{`{${variable.key}}`}</code>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium'>{variable.label}</span>
          {variable.secret && <Lock className='size-3 text-muted-foreground' />}
          {variable.type && variable.type !== FieldType.TEXT && (
            <span className='rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>
              {VARIABLE_TYPES.find((t) => t.value === variable.type)?.label ?? variable.type}
            </span>
          )}
          {variable.required !== false && (
            <span className='text-xs text-muted-foreground'>required</span>
          )}
        </div>
        {variable.description && (
          <p className='text-xs text-muted-foreground truncate'>{variable.description}</p>
        )}
      </div>
      <div className='opacity-0 group-hover:opacity-100 transition-opacity flex gap-1'>
        <Button variant='ghost' size='icon-sm' onClick={onEdit}>
          <Edit2 />
        </Button>
        <Button
          variant='ghost'
          size='icon-sm'
          className='text-destructive hover:text-destructive'
          onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}

/** Dialog for defining connection variables */
export function ConnectionVariableDialog({
  open,
  onOpenChange,
  variables,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  variables: PortalConnectionVariable[]
  onChange: (variables: PortalConnectionVariable[]) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [formData, setFormData] = useState<PortalConnectionVariable>(emptyVariable())

  // An existing variable with no stored `type` is a TEXT variable (that is how every
  // renderer reads it), so the picker resolves an absent type rather than showing blank.
  const currentType = (formData.type ?? FieldType.TEXT) as VariableType
  const validation = formData.validation

  const setValidation = (patch: Partial<VariableValidation>) =>
    setFormData((prev) => ({ ...prev, validation: { ...prev.validation, ...patch } }))

  const handleAdd = () => {
    setEditingIndex(null)
    setFormData(emptyVariable())
    setIsEditing(true)
  }

  const handleEdit = (index: number) => {
    const v = variables[index]
    setEditingIndex(index)
    setFormData({ ...v })
    setIsEditing(true)
  }

  const handleDelete = (index: number) => {
    onChange(variables.filter((_, i) => i !== index))
  }

  const handleSave = () => {
    const keyRegex = /^[a-z][a-z0-9_]*$/
    if (!keyRegex.test(formData.key)) {
      toastError({
        title: 'Invalid key',
        description:
          'Key must start with a letter and contain only lowercase letters, numbers, and underscores.',
      })
      return
    }
    if (!formData.label.trim()) {
      toastError({
        title: 'Label required',
        description: 'Please provide a label for this variable.',
      })
      return
    }

    const isDuplicate = variables.some((v, i) => v.key === formData.key && i !== editingIndex)
    if (isDuplicate) {
      toastError({
        title: 'Duplicate key',
        description: `A variable with key "${formData.key}" already exists.`,
      })
      return
    }

    const options = cleanOptions(formData.options)
    if (currentType === FieldType.SINGLE_SELECT) {
      if (options.length === 0) {
        toastError({
          title: 'Options required',
          description: 'A single-select variable needs at least one option.',
        })
        return
      }
      if (options.some((opt) => !opt.value)) {
        toastError({
          title: 'Option value required',
          description: 'Every option needs a value: it is what the connection stores.',
        })
        return
      }
      const duplicateValue = options.find(
        (opt, i) => options.findIndex((other) => other.value === opt.value) !== i
      )
      if (duplicateValue) {
        toastError({
          title: 'Duplicate option value',
          description: `More than one option uses the value "${duplicateValue.value}".`,
        })
        return
      }
    }

    const updated = [...variables]
    // Conditional spreads keep the stored shape minimal: a plain TEXT variable serialises
    // exactly as it did before typing existed, and every reader treats an absent `type` as TEXT.
    const cleanedValidation = cleanValidation(currentType, formData.validation)
    const cleanedData: PortalConnectionVariable = {
      key: formData.key,
      label: formData.label.trim(),
      ...(formData.description?.trim() && { description: formData.description.trim() }),
      ...(formData.placeholder?.trim() && { placeholder: formData.placeholder.trim() }),
      ...(formData.required === false && { required: false }),
      ...(formData.secret && { secret: true }),
      ...(currentType !== FieldType.TEXT && { type: currentType }),
      ...(currentType === FieldType.SINGLE_SELECT && options.length > 0 && { options }),
      ...(currentType === FieldType.TEXT && formData.multiline === true && { multiline: true }),
      ...(cleanedValidation && { validation: cleanedValidation }),
    }

    if (editingIndex !== null) {
      updated[editingIndex] = cleanedData
    } else {
      updated.push(cleanedData)
    }
    onChange(updated)
    setIsEditing(false)
    setEditingIndex(null)
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditingIndex(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Connection Variables</DialogTitle>
          <DialogDescription>
            Define variables that organizations must provide when setting up this connection.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Variables</span>
            <Button type='button' variant='outline' size='sm' onClick={handleAdd}>
              <Plus />
              Add Variable
            </Button>
          </div>

          {variables.length === 0 && !isEditing ? (
            <div className=''>
              <Empty className='border border-primary-300'>
                <EmptyHeader className='gap-0'>
                  <EmptyMedia variant='icon' className='bg-primary-100'>
                    <Variable />
                  </EmptyMedia>
                  <EmptyTitle>No variables defined</EmptyTitle>
                  <EmptyDescription>
                    Add variables for dynamic values like shop subdomains or client credentials.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          ) : (
            <ScrollArea className='max-h-[240px]'>
              <div className='space-y-2'>
                {variables.map((v, i) => (
                  <VariableDefinitionItem
                    key={v.key}
                    variable={v}
                    onEdit={() => handleEdit(i)}
                    onDelete={() => handleDelete(i)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}

          {isEditing && (
            <div className='space-y-3 border rounded-lg p-3 bg-primary-100'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>
                  {editingIndex !== null ? 'Edit Variable' : 'Add Variable'}
                </span>
                <Button variant='ghost' size='icon' onClick={handleCancel} className='h-6 w-6'>
                  <X />
                </Button>
              </div>

              <div className='grid grid-cols-2 gap-3'>
                <Field>
                  <FieldLabel htmlFor='cv-key'>
                    Key <span className='text-red-500'>*</span>
                  </FieldLabel>
                  <Input
                    id='cv-key'
                    value={formData.key}
                    onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                    placeholder='shop'
                  />
                  <FieldDescription>
                    Used as {'{'}
                    <em>key</em>
                    {'}'} in URLs and fields
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor='cv-label'>
                    Label <span className='text-red-500'>*</span>
                  </FieldLabel>
                  <Input
                    id='cv-label'
                    value={formData.label}
                    onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                    placeholder='Shop Subdomain'
                  />
                  <FieldDescription>Shown to the user in the connection form</FieldDescription>
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor='cv-type'>Type</FieldLabel>
                <Select
                  value={currentType}
                  onValueChange={(value) =>
                    setFormData({ ...formData, type: value as VariableType })
                  }>
                  <SelectTrigger id='cv-type'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VARIABLE_TYPES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Picks the control the connection form renders. Masking is the Secret switch, not a
                  type.
                </FieldDescription>
              </Field>

              {currentType === FieldType.SINGLE_SELECT && (
                <ConnectionVariableOptionsEditor
                  options={formData.options}
                  onChange={(options) => setFormData({ ...formData, options })}
                />
              )}

              <Field>
                <FieldLabel htmlFor='cv-description'>Description</FieldLabel>
                <Input
                  id='cv-description'
                  value={formData.description ?? ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder='e.g. my-store from my-store.myshopify.com'
                />
              </Field>

              <Field>
                <FieldLabel htmlFor='cv-placeholder'>Placeholder</FieldLabel>
                <Input
                  id='cv-placeholder'
                  value={formData.placeholder ?? ''}
                  onChange={(e) => setFormData({ ...formData, placeholder: e.target.value })}
                  placeholder='my-store'
                />
              </Field>

              <div className='flex items-center gap-6'>
                <div className='flex items-center gap-2'>
                  <Switch
                    id='cv-required'
                    checked={formData.required !== false}
                    onCheckedChange={(checked) => setFormData({ ...formData, required: checked })}
                  />
                  <FieldLabel htmlFor='cv-required'>Required</FieldLabel>
                </div>
                <div className='flex items-center gap-2'>
                  <Switch
                    id='cv-secret'
                    checked={formData.secret ?? false}
                    onCheckedChange={(checked) => setFormData({ ...formData, secret: checked })}
                  />
                  <FieldLabel htmlFor='cv-secret'>Secret</FieldLabel>
                  <TooltipExplanation
                    text='Secret variables are masked in the connection form. Use for values like client secrets that the org provides.'
                    side='right'
                  />
                </div>
                {currentType === FieldType.TEXT && (
                  <div className='flex items-center gap-2'>
                    <Switch
                      id='cv-multiline'
                      checked={formData.multiline ?? false}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, multiline: checked })
                      }
                    />
                    <FieldLabel htmlFor='cv-multiline'>Multiline</FieldLabel>
                    <TooltipExplanation
                      text='Render the input as an autosizing textarea. Use for pasted values like an SSH private key.'
                      side='right'
                    />
                  </div>
                )}
              </div>

              {currentType === FieldType.TEXT && (
                <div className='space-y-3 rounded-lg border bg-background px-2 py-2'>
                  <span className='text-sm font-medium'>Validation</span>
                  <div className='grid grid-cols-2 gap-3'>
                    <Field>
                      <FieldLabel htmlFor='cv-min-length'>Min length</FieldLabel>
                      <Input
                        id='cv-min-length'
                        type='number'
                        min={0}
                        value={numberInputValue(validation?.minLength)}
                        onChange={(e) =>
                          setValidation({ minLength: toNumberOrUndefined(e.target.value) })
                        }
                        placeholder='0'
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor='cv-max-length'>Max length</FieldLabel>
                      <Input
                        id='cv-max-length'
                        type='number'
                        min={0}
                        value={numberInputValue(validation?.maxLength)}
                        onChange={(e) =>
                          setValidation({ maxLength: toNumberOrUndefined(e.target.value) })
                        }
                        placeholder='255'
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor='cv-pattern'>Pattern</FieldLabel>
                    <Input
                      id='cv-pattern'
                      value={validation?.pattern ?? ''}
                      onChange={(e) => setValidation({ pattern: e.target.value })}
                      placeholder='^[a-z0-9-]+$'
                      className='font-mono'
                    />
                    <FieldDescription>
                      Regular expression the value must match. Leave blank for no pattern.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor='cv-message'>Pattern message</FieldLabel>
                    <Input
                      id='cv-message'
                      value={validation?.message ?? ''}
                      onChange={(e) => setValidation({ message: e.target.value })}
                      placeholder='Use lowercase letters, numbers and dashes.'
                      disabled={!validation?.pattern?.trim()}
                    />
                    <FieldDescription>Shown when the pattern does not match.</FieldDescription>
                  </Field>
                </div>
              )}

              {currentType === FieldType.NUMBER && (
                <div className='space-y-3 rounded-lg border bg-background px-2 py-2'>
                  <span className='text-sm font-medium'>Validation</span>
                  <div className='grid grid-cols-2 gap-3'>
                    <Field>
                      <FieldLabel htmlFor='cv-min'>Minimum</FieldLabel>
                      <Input
                        id='cv-min'
                        type='number'
                        value={numberInputValue(validation?.min)}
                        onChange={(e) =>
                          setValidation({ min: toNumberOrUndefined(e.target.value) })
                        }
                        placeholder='0'
                        disabled={validation?.port === true}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor='cv-max'>Maximum</FieldLabel>
                      <Input
                        id='cv-max'
                        type='number'
                        value={numberInputValue(validation?.max)}
                        onChange={(e) =>
                          setValidation({ max: toNumberOrUndefined(e.target.value) })
                        }
                        placeholder='100'
                        disabled={validation?.port === true}
                      />
                    </Field>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Switch
                      id='cv-port'
                      checked={validation?.port ?? false}
                      onCheckedChange={(checked) => setValidation({ port: checked })}
                    />
                    <FieldLabel htmlFor='cv-port'>TCP port</FieldLabel>
                    <TooltipExplanation
                      text='Validate the value as a TCP port (1-65535) instead of a custom range.'
                      side='right'
                    />
                  </div>
                </div>
              )}

              <div className='flex gap-2 justify-end'>
                <Button variant='ghost' size='sm' onClick={handleCancel}>
                  Cancel
                </Button>
                <Button variant='outline' size='sm' onClick={handleSave}>
                  {editingIndex !== null ? 'Update' : 'Add'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
