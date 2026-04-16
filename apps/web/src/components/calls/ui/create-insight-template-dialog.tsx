// apps/web/src/components/calls/ui/create-insight-template-dialog.tsx
'use client'

import { Button, buttonVariants } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'

interface DraftSection {
  title: string
  prompt: string
  type: 'plaintext' | 'list'
}

const EMPTY_SECTION: DraftSection = { title: '', prompt: '', type: 'plaintext' }

interface CreateInsightTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (templateId: string) => void
}

export function CreateInsightTemplateDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateInsightTemplateDialogProps) {
  const [title, setTitle] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [sections, setSections] = useState<DraftSection[]>([{ ...EMPTY_SECTION }])

  const utils = api.useUtils()

  const reset = () => {
    setTitle('')
    setIsDefault(false)
    setSections([{ ...EMPTY_SECTION }])
  }

  const create = api.recording.insightTemplates.create.useMutation({
    onSuccess: (template) => {
      utils.recording.insightTemplates.list.invalidate()
      onCreated?.(template.id)
      reset()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Failed to create template', description: error.message })
    },
  })

  const isPending = create.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned = sections.filter((s) => s.title.trim() && s.prompt.trim())
    if (!title.trim() || cleaned.length === 0) {
      toastError({
        title: 'Missing info',
        description: 'Template needs a title and at least one section with a prompt.',
      })
      return
    }
    create.mutate({
      title: title.trim(),
      isDefault,
      sections: cleaned,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='md'>
        <DialogHeader>
          <DialogTitle>New insight template</DialogTitle>
          <DialogDescription>
            Define the sections and prompts that Auxx will extract from recordings.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-2'>
          <div className='space-y-2'>
            <Label htmlFor='template-title'>Title</Label>
            <Input
              id='template-title'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. BANT, MEDDIC, Customer interview'
            />
          </div>

          <label
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'gap-2 cursor-pointer'
            )}>
            <span className='text-muted-foreground text-xs'>Run on every recording</span>
            <Switch
              size='sm'
              checked={isDefault}
              onCheckedChange={setIsDefault}
              disabled={isPending}
            />
          </label>

          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label>Sections</Label>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => setSections((s) => [...s, { ...EMPTY_SECTION }])}>
                <Plus /> Add section
              </Button>
            </div>

            {sections.map((section, idx) => (
              <div key={idx} className='rounded-2xl border p-3 space-y-2'>
                <InputGroup>
                  <InputGroupInput
                    value={section.title}
                    onChange={(e) =>
                      setSections((prev) =>
                        prev.map((s, i) => (i === idx ? { ...s, title: e.target.value } : s))
                      )
                    }
                    placeholder='Section title'
                  />
                  <InputGroupAddon align='inline-end'>
                    <Select
                      value={section.type}
                      onValueChange={(value: 'plaintext' | 'list') =>
                        setSections((prev) =>
                          prev.map((s, i) => (i === idx ? { ...s, type: value } : s))
                        )
                      }>
                      <SelectTrigger variant='transparent' size='sm' className='w-28'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='plaintext'>Paragraph</SelectItem>
                        <SelectItem value='list'>List</SelectItem>
                      </SelectContent>
                    </Select>
                    {sections.length > 1 && (
                      <InputGroupButton
                        type='button'
                        variant='destructive-hover'
                        size='icon-xs'
                        className='rounded-lg me-0.5'
                        aria-label='Remove section'
                        title='Remove'
                        onClick={() => setSections((prev) => prev.filter((_, i) => i !== idx))}>
                        <Trash2 />
                      </InputGroupButton>
                    )}
                  </InputGroupAddon>
                </InputGroup>
                <Textarea
                  value={section.prompt}
                  onChange={(e) =>
                    setSections((prev) =>
                      prev.map((s, i) => (i === idx ? { ...s, prompt: e.target.value } : s))
                    )
                  }
                  placeholder='What should the AI extract for this section?'
                  rows={3}
                />
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={() => onOpenChange(false)}
              disabled={isPending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              type='submit'
              size='sm'
              variant='outline'
              loading={isPending}
              loadingText='Creating...'
              data-dialog-submit>
              Create template <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
