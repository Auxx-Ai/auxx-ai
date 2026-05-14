// apps/web/src/components/agents/ui/dialogs/agent-general-dialog.tsx
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Spinner } from '@auxx/ui/components/spinner'
import { Textarea } from '@auxx/ui/components/textarea'
import { Check, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { AgentAvatar } from '../shared/agent-avatar'

export interface AgentGeneralFormValues {
  name: string
  slug: string
  description: string
}

interface AgentGeneralDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  initialValues?: Partial<AgentGeneralFormValues>
  /** Lock slug field after create — slugs are immutable post-create in v1. */
  lockSlug?: boolean
  isSubmitting?: boolean
  onSubmit: (values: AgentGeneralFormValues) => Promise<void> | void
  onCancel?: () => void
}

const SLUG_REGEX = /^[a-z0-9-]+$/

function toSlug(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function AgentGeneralDialog({
  open,
  onOpenChange,
  mode,
  initialValues,
  lockSlug,
  isSubmitting,
  onSubmit,
  onCancel,
}: AgentGeneralDialogProps) {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [slug, setSlug] = useState(initialValues?.slug ?? '')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [touchedSlug, setTouchedSlug] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Slug availability state
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null)
  const [isCheckingSlug, setIsCheckingSlug] = useState(false)

  const utils = api.useUtils()

  useEffect(() => {
    if (!open) return
    setName(initialValues?.name ?? '')
    setSlug(initialValues?.slug ?? '')
    setDescription(initialValues?.description ?? '')
    setTouchedSlug(!!initialValues?.slug)
    setError(null)
    setSlugAvailable(null)
    setIsCheckingSlug(false)
  }, [open, initialValues])

  const checkSlug = useDebouncedCallback(async (slugToCheck: string) => {
    if (!slugToCheck || !SLUG_REGEX.test(slugToCheck)) {
      setSlugAvailable(null)
      setIsCheckingSlug(false)
      return
    }
    try {
      const result = await utils.agent.checkSlug.fetch({ slug: slugToCheck })
      setSlugAvailable(result.available)
    } catch {
      setSlugAvailable(false)
    } finally {
      setIsCheckingSlug(false)
    }
  }, 300)

  // Auto-derive slug from name when user hasn't manually edited it (create mode only)
  useEffect(() => {
    if (mode !== 'create' || touchedSlug) return
    const derived = toSlug(name)
    setSlug(derived)
    if (derived) {
      setIsCheckingSlug(true)
      checkSlug(derived)
    } else {
      setSlugAvailable(null)
    }
  }, [name, mode, touchedSlug, checkSlug])

  const handleSlugChange = useCallback(
    (value: string) => {
      setTouchedSlug(true)
      const next = toSlug(value)
      setSlug(next)
      if (next) {
        setIsCheckingSlug(true)
        checkSlug(next)
      } else {
        setSlugAvailable(null)
      }
    },
    [checkSlug]
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (name.length > 120) {
      setError('Name must be 120 characters or fewer')
      return
    }
    if (!slug.trim()) {
      setError('Slug is required')
      return
    }
    if (!SLUG_REGEX.test(slug)) {
      setError('Slug may only contain lowercase letters, digits, and dashes')
      return
    }
    if (slug.length > 60) {
      setError('Slug must be 60 characters or fewer')
      return
    }
    if (description.length > 500) {
      setError('Description must be 500 characters or fewer')
      return
    }
    await onSubmit({ name: name.trim(), slug: slug.trim(), description: description.trim() })
  }

  const handleOpenChange = (next: boolean) => {
    if (!next && onCancel) onCancel()
    onOpenChange(next)
  }

  const isCreate = mode === 'create'
  const slugLocked = !!lockSlug || !isCreate
  const isValid =
    name.trim().length > 0 &&
    slug.trim().length > 0 &&
    SLUG_REGEX.test(slug) &&
    (slugLocked || slugAvailable === true)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>{isCreate ? 'Create agent' : 'Edit agent'}</DialogTitle>
          <DialogDescription>
            {isCreate
              ? 'Give your agent a name and slug. You can refine prompt, tools, and knowledge after.'
              : 'Update the agent name and description.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup className='gap-4'>
            <div className='grid grid-cols-[30px_1fr] gap-2 items-end'>
              <Field>
                <FieldLabel className='sr-only'>Avatar</FieldLabel>
                <AgentAvatar agent={{ name, avatarUrl: null }} size={7} />
              </Field>
              <Field>
                <FieldLabel htmlFor='agent-name'>Name</FieldLabel>
                <Input
                  id='agent-name'
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder='Sarah'
                  autoFocus
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor='agent-slug'>Slug</FieldLabel>
              <InputGroup>
                <InputGroupAddon align='inline-start'>
                  <InputGroupText>/</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id='agent-slug'
                  value={slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder='sarah'
                  disabled={slugLocked}
                />
                <InputGroupAddon align='inline-end'>
                  {!slugLocked && isCheckingSlug ? (
                    <Spinner />
                  ) : !slugLocked && slug ? (
                    slugAvailable === true ? (
                      <Check className='size-4 text-success' />
                    ) : slugAvailable === false ? (
                      <X className='size-4 text-destructive' />
                    ) : null
                  ) : null}
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                {slugLocked
                  ? 'Slug cannot be changed after creation.'
                  : 'Used in @mentions and URLs. Lowercase letters, digits, and dashes only.'}
              </FieldDescription>
              {slugAvailable === false && !slugLocked && (
                <FieldError>This slug is already in use.</FieldError>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor='agent-description'>Description</FieldLabel>
              <Textarea
                id='agent-description'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder='Returns specialist'
                rows={3}
              />
            </Field>

            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>

          <DialogFooter>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              type='submit'
              size='sm'
              variant='outline'
              loading={isSubmitting}
              loadingText='Saving…'
              disabled={!isValid || isSubmitting}>
              {isCreate ? 'Create agent' : 'Save'} <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
