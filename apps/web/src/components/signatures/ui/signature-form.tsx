// apps/web/src/components/signatures/ui/signature-form.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent } from '@auxx/ui/components/card'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Form, FormLabel } from '@auxx/ui/components/form'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { TooltipError } from '@auxx/ui/components/tooltip'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { type ReactNode, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { EditorToolbar } from '~/components/editor/editor-button'
import { EditorProvider } from '~/components/editor/editor-context'
import { useSignature, useSignatureAccess, useSignatureMutations } from '../hooks'
import { SignatureBodyEditor } from './signature-body-editor'

/**
 * Form validation schema for signatures.
 *
 * Name + body are the whole editable surface. `visibility` and `isDefault` are
 * gone: migration 057 deleted both fields, sharing moved to `ResourceAccess`
 * (the Share… action on the list row), and "default" is a per-user
 * `UserSetting` set from the list, not a property of the signature.
 */
const formSchema = z.object({
  name: z.string().min(1, 'Signature name is required'),
  body: z.string().min(1, 'Signature content is required'),
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
 * page.
 *
 * At the `view` rung the form renders READ-ONLY — inputs disabled, editor not
 * editable, no submit button — rather than being unreachable, so a shared
 * signature can still be inspected before it is stamped on a reply. The list's
 * menu item flips to "View" for exactly this case. `signature.update` asserts
 * `edit` regardless; this is degrade-only.
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
  const { canEdit } = useSignatureAccess(signatureId)
  const readOnly = isEditing && !canEdit

  const [html, setHtml] = useState(signature?.body || '')

  const form = useForm<FormData>({
    resolver: standardSchemaResolver(formSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      name: signature?.name || '',
      body: signature?.body || '',
    },
  })

  // Guard: editing an id that resolves to nothing (e.g. deleted, or un-shared)
  // -> close.
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
      form.reset({ name: signature.name, body: signature.body })
      setHtml(signature.body)
    }
  }, [open, signature, form])

  const onSubmit = async (data: FormData) => {
    data.body = html

    let savedId = signatureId ?? ''

    if (signature) {
      await update(signature.id, { name: data.name, body: data.body })
    } else {
      const result = await create({ name: data.name, body: data.body })
      savedId = result?.id ?? ''
    }

    onSuccess?.(savedId)
    onClose()
  }

  const handleEditorChange = (newHtml: string) => {
    setHtml(newHtml)
    form.setValue('body', newHtml, { shouldDirty: true, shouldTouch: true })
  }

  const isPending = isCreating || isUpdating
  const title = isEditing ? (readOnly ? 'Signature' : 'Edit Signature') : 'Create Signature'

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
                disabled={readOnly}
                {...form.register('name')}
              />
              {form.formState.errors.name && (
                <InputGroupAddon align='inline-end'>
                  <TooltipError text={form.formState.errors.name.message ?? ''} />
                </InputGroupAddon>
              )}
            </InputGroup>
          </div>

          <div className='space-y-2'>
            <EditorProvider>
              <FormLabel>Signature Content</FormLabel>
              <Card className='overflow-hidden'>
                <CardContent className='p-0'>
                  {!readOnly && (
                    <div className='border-b px-3 py-2'>
                      <EditorToolbar showSend={false} />
                    </div>
                  )}
                  <SignatureBodyEditor
                    content={html}
                    onChange={handleEditorChange}
                    placeholder='Design your signature here...'
                    className='h-full'
                    editable={!readOnly}
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
              {readOnly ? 'Close' : 'Cancel'} <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            {!readOnly && (
              <Button
                type='submit'
                size='sm'
                variant='outline'
                loading={isPending}
                loadingText={isEditing ? 'Saving...' : 'Creating...'}>
                {isEditing ? 'Save Changes' : 'Create Signature'}{' '}
                <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
          </DialogFooter>
        </form>
      </Form>
    </>
  )
}
