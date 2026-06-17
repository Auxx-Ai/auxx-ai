// apps/web/src/components/signatures/ui/signature-form.tsx
'use client'

import { parseRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent } from '@auxx/ui/components/card'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Form, FormLabel } from '@auxx/ui/components/form'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { TooltipError } from '@auxx/ui/components/tooltip'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { GlobeIcon, LockIcon, StarIcon } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { EditorToolbar } from '~/components/editor/editor-button'
import { EditorProvider } from '~/components/editor/editor-context'
import { type SignatureVisibility, useSignature, useSignatureMutations } from '../hooks'
import { SignatureBodyEditor } from './signature-body-editor'

/** Form validation schema for signatures */
const formSchema = z.object({
  name: z.string().min(1, 'Signature name is required'),
  body: z.string().min(1, 'Signature content is required'),
  isDefault: z.boolean().optional(),
  visibility: z.enum(['private', 'org_members'] as const),
})

type FormData = z.infer<typeof formSchema>

/** Props for the shell-free signature form core. */
export interface SignatureFormProps {
  /** Whether the form is "open" — drives the init/reset cycle. In a dialog this is
   *  the dialog's open state; in the palette it's `page === 'create-signature'`. */
  open: boolean
  /** Signature id (instance id) for edit mode; null/undefined = create */
  signatureId?: string | null
  /** Called after a successful save with the saved signature id (for auto-select) */
  onSuccess?: (signatureId: string) => void
  /** Dismiss after a successful save / unrecoverable state (dialog closes; palette
   *  closes). */
  onClose: () => void
  /** Cancel/back dismiss. Defaults to {@link onClose}; the palette routes it back
   *  to the root action list instead of closing outright. */
  onCancel?: () => void
  /** Host-specific header. Dialogs render a `DialogHeader`; the palette omits it
   *  (the breadcrumb supplies the title). */
  header?: (ctx: { title: string }) => ReactNode
}

/**
 * Shell-free signature create/edit form: all hooks/state, the field body, and the
 * footer (Cancel / Create). The only host seams are the `header` slot and `onClose`.
 * `signature-dialog.tsx` wraps this in a `Dialog`; the command palette hosts it as a
 * page. Behavior is unchanged from the original dialog (no "create more", no dirty
 * guard).
 */
export function SignatureForm({
  open,
  signatureId,
  onSuccess,
  onClose,
  onCancel,
  header,
}: SignatureFormProps) {
  const cancel = onCancel ?? onClose
  const isEditing = !!signatureId
  const { signature } = useSignature(signatureId)
  const { create, update, isCreating, isUpdating } = useSignatureMutations()

  const [html, setHtml] = useState(signature?.body || '')

  const form = useForm<FormData>({
    resolver: standardSchemaResolver(formSchema, undefined, { mode: 'sync' }),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      name: signature?.name || '',
      body: signature?.body || '',
      isDefault: signature?.isDefault || false,
      visibility: signature?.visibility || 'private',
    },
  })

  // Guard: editing an id that resolves to nothing (e.g. deleted) -> close.
  useEffect(() => {
    if (open && isEditing && !signature) {
      toastError({
        title: 'Signature not found',
        description: 'The signature may have been deleted.',
      })
      onClose()
    }
  }, [open, isEditing, signature, onClose])

  // Hydrate the form once the signature resolves (edit mode).
  useEffect(() => {
    if (open && signature) {
      form.reset({
        name: signature.name,
        body: signature.body,
        isDefault: signature.isDefault,
        visibility: signature.visibility,
      })
      setHtml(signature.body)
    }
  }, [open, signature, form])

  const onSubmit = async (data: FormData) => {
    data.body = html

    let savedId = signatureId ?? ''

    if (signature?.recordId) {
      await update(signature.recordId, {
        name: data.name,
        body: data.body,
        isDefault: data.isDefault,
        visibility: data.visibility,
      })
    } else {
      const result = await create({
        name: data.name,
        body: data.body,
        isDefault: data.isDefault,
        visibility: data.visibility,
      })
      savedId = parseRecordId(result.recordId).entityInstanceId
    }

    onSuccess?.(savedId)
    onClose()
  }

  const handleEditorChange = (newHtml: string) => {
    setHtml(newHtml)
    form.setValue('body', newHtml, { shouldDirty: true, shouldTouch: true })
  }

  const visibility = form.watch('visibility')
  const isDefault = form.watch('isDefault')
  const isPending = isCreating || isUpdating
  const title = isEditing ? 'Edit Signature' : 'Create Signature'

  const VisibilityIcon = visibility === 'org_members' ? GlobeIcon : LockIcon

  return (
    <>
      {header?.({ title })}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
          <div className='flex flex-col space-y-2'>
            <FormLabel htmlFor='signature-name'>Signature Name</FormLabel>
            <InputGroup>
              <InputGroupInput
                id='signature-name'
                placeholder='e.g., Professional, Casual, Support Team'
                aria-invalid={!!form.formState.errors.name}
                {...form.register('name')}
              />
              <InputGroupAddon align='inline-end'>
                <button
                  type='button'
                  title={isDefault ? 'Default signature' : 'Set as default'}
                  onClick={() => form.setValue('isDefault', !isDefault, { shouldDirty: true })}
                  className='flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted'>
                  <StarIcon
                    className={isDefault ? 'size-4 fill-yellow-500 text-yellow-500' : 'size-4'}
                  />
                </button>
                <Select
                  value={visibility}
                  onValueChange={(v) =>
                    form.setValue('visibility', v as SignatureVisibility, { shouldDirty: true })
                  }>
                  <SelectTrigger
                    variant='ghost'
                    size='xs'
                    className='mr-0.5 gap-1 text-muted-foreground'>
                    <VisibilityIcon className='size-3.5' />
                    <SelectValue placeholder='Visibility' />
                  </SelectTrigger>
                  <SelectContent align='end'>
                    <SelectItem value='private'>Private</SelectItem>
                    <SelectItem value='org_members'>All Members</SelectItem>
                  </SelectContent>
                </Select>
                {form.formState.errors.name && (
                  <TooltipError text={form.formState.errors.name.message ?? ''} />
                )}
              </InputGroupAddon>
            </InputGroup>
          </div>

          <div className='space-y-2'>
            <EditorProvider>
              <FormLabel>Signature Content</FormLabel>
              <Card className='overflow-hidden'>
                <CardContent className='p-0'>
                  <div className='border-b px-3 py-2'>
                    <EditorToolbar showSend={false} />
                  </div>
                  <SignatureBodyEditor
                    content={html}
                    onChange={handleEditorChange}
                    placeholder='Design your signature here...'
                    className='h-full'
                  />
                </CardContent>
              </Card>
              {form.formState.errors.body && (
                <p className='text-sm font-medium text-destructive'>
                  {form.formState.errors.body.message}
                </p>
              )}
            </EditorProvider>
          </div>

          <DialogFooter>
            <Button type='button' size='sm' variant='ghost' onClick={cancel}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              type='submit'
              size='sm'
              variant='outline'
              loading={isPending}
              loadingText={isEditing ? 'Saving...' : 'Creating...'}>
              {isEditing ? 'Save Changes' : 'Create Signature'}{' '}
              <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}
