// apps/web/src/app/(protected)/app/tickets/settings/templates/_components/template-editor-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Separator } from '@auxx/ui/components/separator'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { LoaderIcon, Save, Undo } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import { TemplateVariablesPopover } from './template-variables-popover'

/** Template type options */
const TEMPLATE_TYPES = [
  { value: 'TICKET_CREATED', label: 'Ticket Created' },
  { value: 'TICKET_REPLIED', label: 'Ticket Reply' },
  { value: 'TICKET_CLOSED', label: 'Ticket Closed' },
  { value: 'TICKET_REOPENED', label: 'Ticket Reopened' },
  { value: 'TICKET_ASSIGNED', label: 'Ticket Assigned' },
  { value: 'TICKET_STATUS_CHANGED', label: 'Status Changed' },
  { value: 'CUSTOM', label: 'Custom Template' },
] as const

/** Get template type label from value */
const getTemplateTypeName = (type: string) => {
  return TEMPLATE_TYPES.find((t) => t.value === type)?.label ?? type
}

interface TemplateEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templateId?: string | null
  onSave?: () => void
}

/** Template editor dialog component for creating and editing email templates */
export function TemplateEditorDialog({
  open,
  onOpenChange,
  templateId,
  onSave,
}: TemplateEditorDialogProps) {
  const isEditing = !!templateId
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null)

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'TICKET_CREATED',
    subject: '',
    bodyHtml: '',
    bodyPlain: '',
    isActive: true,
  })
  const [originalData, setOriginalData] = useState({} as typeof formData)
  const [hasChanges, setHasChanges] = useState(false)

  /** Query to get template details if editing */
  const { data: templateData, isLoading: isTemplateLoading } =
    api.emailTemplate.getTemplate.useQuery(
      { id: templateId! },
      {
        enabled: !!templateId && open,
      }
    )

  /** Reset form when dialog opens/closes or template changes */
  useEffect(() => {
    if (open && templateData?.template) {
      const template = templateData.template
      const newFormData = {
        name: template.name,
        description: template.description || '',
        type: template.type,
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        bodyPlain: template.bodyPlain || '',
        isActive: template.isActive,
      }
      setFormData(newFormData)
      setOriginalData(newFormData)
    } else if (open && !templateId) {
      // Reset for create mode
      const defaultFormData = {
        name: '',
        description: '',
        type: 'TICKET_CREATED',
        subject: '',
        bodyHtml: '',
        bodyPlain: '',
        isActive: true,
      }
      setFormData(defaultFormData)
      setOriginalData(defaultFormData)
    }
  }, [open, templateData, templateId])

  /** Reset state when dialog closes */
  useEffect(() => {
    if (!open) {
      setHasChanges(false)
    }
  }, [open])

  // Mutations
  const createTemplate = api.emailTemplate.createTemplate.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Template created',
        description: 'Your email template has been created successfully',
      })
      setOriginalData(formData)
      setHasChanges(false)
      onOpenChange(false)
      onSave?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error creating template',
        description: error.message,
      })
    },
  })

  const updateTemplate = api.emailTemplate.updateTemplate.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Template updated',
        description: 'Your email template has been updated successfully',
      })
      setOriginalData(formData)
      setHasChanges(false)
      onOpenChange(false)
      onSave?.()
    },
    onError: (error) => {
      toastError({
        title: 'Error updating template',
        description: error.message,
      })
    },
  })

  /** Check for form changes */
  useEffect(() => {
    if (Object.keys(originalData).length === 0) return

    const changed = Object.keys(formData).some(
      (key) =>
        formData[key as keyof typeof formData] !== originalData[key as keyof typeof originalData]
    )

    setHasChanges(changed)
  }, [formData, originalData])

  /** Handle form input changes */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  /** Handle template type select change */
  const handleTypeChange = (value: string) => {
    setFormData((prev) => ({ ...prev, type: value }))
  }

  /** Save template */
  const handleSave = async () => {
    if (templateId) {
      await updateTemplate.mutateAsync({
        id: templateId,
        name: formData.name,
        description: formData.description,
        subject: formData.subject,
        bodyHtml: formData.bodyHtml,
        bodyPlain: formData.bodyPlain,
        isActive: formData.isActive,
      })
    } else {
      await createTemplate.mutateAsync({
        name: formData.name,
        description: formData.description,
        type: formData.type as any,
        subject: formData.subject,
        bodyHtml: formData.bodyHtml,
        bodyPlain: formData.bodyPlain,
        isActive: formData.isActive,
      })
    }
  }

  /** Reset changes */
  const handleReset = () => {
    setFormData(originalData)
  }

  /** Handle cancel with unsaved changes warning */
  const handleCancel = () => {
    if (hasChanges) {
      if (confirm('You have unsaved changes. Are you sure you want to cancel?')) {
        onOpenChange(false)
      }
    } else {
      onOpenChange(false)
    }
  }

  /** Insert a variable placeholder at cursor position in HTML body */
  const handleInsertPlaceholder = (placeholder: string) => {
    const textarea = htmlTextareaRef.current
    if (!textarea) {
      // Fallback: append to end
      setFormData((prev) => ({ ...prev, bodyHtml: prev.bodyHtml + placeholder }))
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = formData.bodyHtml
    const newText = text.substring(0, start) + placeholder + text.substring(end)

    setFormData((prev) => ({ ...prev, bodyHtml: newText }))

    // Restore cursor position after the inserted placeholder
    requestAnimationFrame(() => {
      textarea.focus()
      const newPosition = start + placeholder.length
      textarea.setSelectionRange(newPosition, newPosition)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='3xl' className='max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Email Template' : 'Create New Email Template'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? `Editing ${getTemplateTypeName(formData.type)} template`
              : 'Create a custom email template for your organization'}
          </DialogDescription>
        </DialogHeader>

        {isTemplateLoading ? (
          <div className='py-10 text-center'>
            <div className='flex justify-center'>
              <LoaderIcon className='h-8 w-8 animate-spin text-muted-foreground' />
            </div>
            <p className='mt-4 text-muted-foreground'>Loading template...</p>
          </div>
        ) : (
          <div className='space-y-6'>
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='name'>Template Name</Label>
                <Input
                  id='name'
                  name='name'
                  value={formData.name}
                  onChange={handleChange}
                  placeholder='e.g., Welcome Email'
                />
              </div>

              {!isEditing && (
                <div className='space-y-2'>
                  <Label htmlFor='type'>Template Type</Label>
                  <Select value={formData.type} onValueChange={handleTypeChange}>
                    <SelectTrigger id='type'>
                      <SelectValue placeholder='Select template type' />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='description'>Description</Label>
              <Textarea
                id='description'
                name='description'
                value={formData.description}
                onChange={handleChange}
                placeholder='Brief description of when this template is used'
                rows={2}
              />
            </div>

            <Separator />

            <div className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='subject'>Email Subject</Label>
                <Input
                  id='subject'
                  name='subject'
                  value={formData.subject}
                  onChange={handleChange}
                  placeholder='e.g., Your ticket {{ticket.number}} has been created'
                />
              </div>

              <div className='grid sm:grid-cols-2 gap-4'>
                <div className='relative flex flex-col space-y-2'>
                  <div className='flex items-center justify-between'>
                    <Label htmlFor='bodyHtml'>HTML Body</Label>
                  </div>
                  <div className='absolute right-2 bottom-2 z-10'>
                    <TemplateVariablesPopover
                      templateType={formData.type}
                      onInsert={handleInsertPlaceholder}
                    />
                  </div>
                  <Textarea
                    ref={htmlTextareaRef}
                    id='bodyHtml'
                    name='bodyHtml'
                    value={formData.bodyHtml}
                    onChange={handleChange}
                    placeholder='<p>Dear {{customer.name}},</p><p>Your ticket has been created.</p>'
                    rows={18}
                    className='font-mono text-sm'
                  />
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='bodyPlain'>Plain Text Body (Optional)</Label>
                  <Textarea
                    id='bodyPlain'
                    name='bodyPlain'
                    value={formData.bodyPlain}
                    onChange={handleChange}
                    placeholder='Dear {{customer.name}},\n\nYour ticket has been created.'
                    rows={18}
                    className='font-mono text-sm'
                  />
                </div>
              </div>
            </div>

            <div className='flex justify-between pt-4 pb-4 sm:pb-0'>
              <div className='flex gap-2'>
                <Button variant='outline' onClick={handleCancel}>
                  Cancel
                </Button>
                {hasChanges && (
                  <Button variant='outline' onClick={handleReset}>
                    <Undo />
                    Reset Changes
                  </Button>
                )}
              </div>
              <Button
                onClick={handleSave}
                disabled={!hasChanges}
                loading={createTemplate.isPending || updateTemplate.isPending}
                loadingText='Saving...'>
                <Save />
                Save Template
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
