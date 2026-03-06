// apps/build/src/app/(portal)/[slug]/apps/[app_slug]/connections/connection-variable-dialog.tsx
'use client'

import type { ConnectionVariable } from '@auxx/database'
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
import { Switch } from '@auxx/ui/components/switch'
import { TooltipExplanation } from '@auxx/ui/components/tooltip'
import { Edit2, Lock, Plus, Trash2, Variable, X } from 'lucide-react'
import { useState } from 'react'
import { toastError } from '~/components/global/toast'

/** Variable definition item row */
function VariableDefinitionItem({
  variable,
  onEdit,
  onDelete,
}: {
  variable: ConnectionVariable
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
  variables: ConnectionVariable[]
  onChange: (variables: ConnectionVariable[]) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [formData, setFormData] = useState<ConnectionVariable>({
    key: '',
    label: '',
    description: '',
    placeholder: '',
    required: true,
    secret: false,
  })

  const handleAdd = () => {
    setEditingIndex(null)
    setFormData({
      key: '',
      label: '',
      description: '',
      placeholder: '',
      required: true,
      secret: false,
    })
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

    const updated = [...variables]
    const cleanedData: ConnectionVariable = {
      key: formData.key,
      label: formData.label.trim(),
      ...(formData.description?.trim() && { description: formData.description.trim() }),
      ...(formData.placeholder?.trim() && { placeholder: formData.placeholder.trim() }),
      ...(formData.required === false && { required: false }),
      ...(formData.secret && { secret: true }),
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
              </div>

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
