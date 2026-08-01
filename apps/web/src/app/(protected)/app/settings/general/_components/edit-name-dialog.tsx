// apps/web/src/app/(protected)/app/settings/general/_components/edit-name-dialog.tsx
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import type React from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useDehydratedStateContext } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

const nameFormSchema = z.object({
  username: z
    .string()
    .min(2, { error: 'Name must be at least 2 characters.' })
    .max(30, { error: 'Name must not be longer than 30 characters.' }),
})

type NameFormValues = z.infer<typeof nameFormSchema>

interface EditNameDialogProps {
  currentName: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Dialog for changing the user's display name. Mirrors the inline edit pattern
 * used by the email field — a read-only field with an inset Edit button opens it.
 */
export function EditNameDialog({
  currentName,
  isOpen,
  onOpenChange,
}: EditNameDialogProps): React.JSX.Element | null {
  if (!isOpen) return null

  const { patchUser } = useDehydratedStateContext()
  const updateProfile = api.user.updateProfile.useMutation()

  const form = useForm<NameFormValues>({
    resolver: standardSchemaResolver(nameFormSchema),
    defaultValues: { username: currentName },
    mode: 'onChange',
  })

  async function onSubmit(data: NameFormValues) {
    try {
      if (data.username !== currentName) {
        await updateProfile.mutateAsync({ name: data.username })
        patchUser({ name: data.username })
      }
      onOpenChange(false)
    } catch {
      toastError({
        title: 'Update failed',
        description: 'Failed to update your name',
      })
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='sm'>
        <DialogHeader>
          <DialogTitle>Change Name</DialogTitle>
          <DialogDescription>
            This is your public display name. It can be your real name or a pseudonym.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name='username'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder='Your name' autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => onOpenChange(false)}
                disabled={updateProfile.isPending}>
                Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              <Button
                type='submit'
                variant='outline'
                size='sm'
                loading={updateProfile.isPending}
                loadingText='Saving...'
                disabled={!form.formState.isValid || updateProfile.isPending}
                data-dialog-submit>
                Save <KbdSubmit variant='outline' size='sm' />
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
