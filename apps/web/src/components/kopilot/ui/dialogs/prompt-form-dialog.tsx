// apps/web/src/components/kopilot/ui/dialogs/prompt-form-dialog.tsx

'use client'

import { isNonEmptyDoc } from '@auxx/lib/tiptap'
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
import { toastError } from '@auxx/ui/components/toast'
import type { JSONContent } from '@tiptap/core'
import { Trash2 } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_TABS } from '~/components/editor/inline-picker'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import { PromptEditor } from '~/components/editor/prompt-editor'
import { useConfirm } from '~/hooks/use-confirm'
import { usePromptTemplateMutations } from '../../hooks/use-prompt-template-mutations'

interface PromptDoc {
  type: 'doc'
  content: JSONContent[]
}

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
        prompt: PromptDoc
        icon?: { iconId: string; color: string } | null
      }
      onDeleted?: () => void
    }

const DEFAULT_ICON: IconPickerValue = { icon: 'sparkles', color: 'violet' }

// Templates share the persona editor's admin-only reference tabs — authors
// want to drop tool / record / field chips into the prompt body.
const TEMPLATE_REFERENCE_TABS: ReferenceTab[] = [...DEFAULT_TABS, 'tools', 'resources', 'fields']

function emptyPromptDoc(): PromptDoc {
  return {
    type: 'doc',
    content: [{ type: 'block', attrs: { blockType: 'text' }, content: [] }],
  }
}

function readPromptContent(doc: PromptDoc | null | undefined): JSONContent[] | null {
  if (!doc) return null
  if (!Array.isArray(doc.content)) return null
  return doc.content
}

export function PromptFormDialog(props: PromptFormDialogProps) {
  const { open, onOpenChange } = props
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState<PromptDoc>(emptyPromptDoc)
  // Editor instance lifecycle drives initial-content re-read. Bumping this
  // key on dialog open remounts `PromptEditor` so the new template loads.
  const [editorKey, setEditorKey] = useState(0)
  const [iconValue, setIconValue] = useState<IconPickerValue>(DEFAULT_ICON)

  const { create, update, remove } = usePromptTemplateMutations()
  const [confirm, ConfirmDialog] = useConfirm()

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on open/mode change only
  useEffect(() => {
    if (open) {
      if (props.mode === 'edit') {
        setName(props.promptTemplate.name)
        setDescription(props.promptTemplate.description)
        setPrompt(props.promptTemplate.prompt ?? emptyPromptDoc())
        setIconValue(
          props.promptTemplate.icon
            ? { icon: props.promptTemplate.icon.iconId, color: props.promptTemplate.icon.color }
            : DEFAULT_ICON
        )
      } else {
        setName('')
        setDescription('')
        setPrompt(emptyPromptDoc())
        setIconValue(DEFAULT_ICON)
      }
      setEditorKey((k) => k + 1)
    }
  }, [open, props.mode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toastError({ title: 'Name required', description: 'Please enter a template name' })
      return
    }

    if (!isNonEmptyDoc(prompt)) {
      toastError({ title: 'Prompt required', description: 'Please enter the prompt content' })
      return
    }

    const iconData = { iconId: iconValue.icon, color: iconValue.color }

    if (props.mode === 'create') {
      const result = await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || name.trim(),
        prompt,
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
        prompt,
        icon: iconData,
      })
      onOpenChange(false)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  const handleDelete = async () => {
    if (props.mode !== 'edit') return
    const confirmed = await confirm({
      title: 'Delete prompt template?',
      description: 'This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    await remove.mutateAsync({ id: props.promptTemplate.id })
    onOpenChange(false)
    props.onDeleted?.()
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
        className='sm:max-w-[600px]'
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
              <Label htmlFor='prompt-content'>Prompt</Label>
              <div className='rounded-md border bg-background min-h-[200px] px-3 py-2'>
                <PromptEditor
                  key={editorKey}
                  initialContent={readPromptContent(prompt)}
                  onChange={({ json }) => setPrompt(json as PromptDoc)}
                  referenceTabs={TEMPLATE_REFERENCE_TABS}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            {props.mode === 'edit' && (
              <Button
                type='button'
                size='sm'
                variant='destructive-hover'
                onClick={handleDelete}
                loading={remove.isPending}
                loadingText='Deleting...'
                className='mr-auto'>
                <Trash2 />
                Delete
              </Button>
            )}
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
      <ConfirmDialog />
    </Dialog>
  )
}
