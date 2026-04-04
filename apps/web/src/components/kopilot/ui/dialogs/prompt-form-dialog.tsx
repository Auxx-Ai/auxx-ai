// apps/web/src/components/kopilot/ui/dialogs/prompt-form-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { IconPicker, type IconPickerValue } from '@auxx/ui/components/icon-picker'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { usePromptTemplateMutations } from '../../hooks/use-prompt-template-mutations'

type PromptFormDialogProps =
  | {
      open: boolean
      onOpenChange: (open: boolean) => void
      mode: 'create'
      onCreated?: (template: { id: string; name: string }) => void
    }
  | {
      open: boolean
      onOpenChange: (open: boolean) => void
      mode: 'edit'
      promptTemplate: {
        id: string
        name: string
        description: string
        prompt: string
        icon?: { iconId: string; color: string } | null
      }
    }

const DEFAULT_ICON: IconPickerValue = { icon: 'sparkles', color: 'violet' }

export function PromptFormDialog(props: PromptFormDialogProps) {
  const { open, onOpenChange } = props
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [iconValue, setIconValue] = useState<IconPickerValue>(DEFAULT_ICON)

  const { create, update } = usePromptTemplateMutations()

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on open/mode change only
  useEffect(() => {
    if (open) {
      if (props.mode === 'edit') {
        setName(props.promptTemplate.name)
        setDescription(props.promptTemplate.description)
        setPrompt(props.promptTemplate.prompt)
        setIconValue(
          props.promptTemplate.icon
            ? { icon: props.promptTemplate.icon.iconId, color: props.promptTemplate.icon.color }
            : DEFAULT_ICON
        )
      } else {
        setName('')
        setDescription('')
        setPrompt('')
        setIconValue(DEFAULT_ICON)
      }
    }
  }, [open, props.mode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toastError({ title: 'Name required', description: 'Please enter a template name' })
      return
    }

    if (!prompt.trim()) {
      toastError({ title: 'Prompt required', description: 'Please enter the prompt content' })
      return
    }

    const iconData = { iconId: iconValue.icon, color: iconValue.color }

    if (props.mode === 'create') {
      const result = await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || name.trim(),
        prompt: prompt.trim(),
        icon: iconData,
      })
      onOpenChange(false)
      if (props.onCreated && result) {
        props.onCreated({ id: result.id, name: result.name })
      }
    } else {
      await update.mutateAsync({
        id: props.promptTemplate.id,
        name: name.trim(),
        description: description.trim(),
        prompt: prompt.trim(),
        icon: iconData,
      })
      onOpenChange(false)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  const isPending = props.mode === 'create' ? create.isPending : update.isPending
  const dialogTitle = props.mode === 'create' ? 'Create Prompt Template' : 'Edit Prompt Template'
  const dialogDescription =
    props.mode === 'create'
      ? 'Create a reusable prompt template for Kopilot.'
      : 'Update your prompt template.'
  const submitText = props.mode === 'create' ? 'Create' : 'Save Changes'
  const loadingText = props.mode === 'create' ? 'Creating...' : 'Saving...'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='sm:max-w-[500px]'
        position='tc'
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          nameInputRef.current?.focus()
        }}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className='grid gap-4'>
            <div className='grid gap-2'>
              <Label htmlFor='prompt-name'>Name</Label>
              <InputGroup>
                <InputGroupAddon align='inline-start' className='ml-1'>
                  <IconPicker
                    value={iconValue}
                    onChange={setIconValue}
                    className='size-6'
                    modal={false}
                  />
                </InputGroupAddon>
                <InputGroupInput
                  ref={nameInputRef}
                  id='prompt-name'
                  autoComplete='off'
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder='Enter template name'
                  disabled={isPending}
                  required
                />
              </InputGroup>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='prompt-description'>Description</Label>
              <Textarea
                id='prompt-description'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder='Short description of what this prompt does'
                disabled={isPending}
                rows={2}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='prompt-content'>Prompt</Label>
              <Textarea
                id='prompt-content'
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='Enter the prompt content that will be sent to Kopilot...'
                className='min-h-[200px]'
                disabled={isPending}
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={handleCancel}
              disabled={isPending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              type='submit'
              variant='outline'
              size='sm'
              loading={isPending}
              loadingText={loadingText}>
              {submitText} <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
