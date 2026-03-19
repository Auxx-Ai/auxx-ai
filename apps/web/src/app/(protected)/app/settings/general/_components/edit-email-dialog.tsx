// apps/web/src/app/(protected)/app/settings/general/_components/edit-email-dialog.tsx
'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel } from '@auxx/ui/components/form'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { TooltipError } from '@auxx/ui/components/tooltip'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { AlertCircle, Mail } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { changeEmail } from '~/auth/auth-client'

/**
 * Schema factory for the change email form (Zod v4 syntax)
 * Ensures: required, valid email, and different from current email
 */
export const makeChangeEmailSchema = (currentEmail: string) =>
  z.object({
    newEmail: z
      .string()
      .min(1, 'Email is required')
      .pipe(z.email('Enter a valid email'))
      .refine(
        (email) => email.trim().toLowerCase() !== currentEmail.trim().toLowerCase(),
        'New email must be different from current email'
      ),
  })

/** Type for the change email form values */
export type ChangeEmailFormValues = z.infer<ReturnType<typeof makeChangeEmailSchema>>

/**
 * Props for the EditEmailDialog component
 */
interface EditEmailDialogProps {
  currentEmail: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

/**
 * Component for changing user email address with verification
 */
export function EditEmailDialog({
  currentEmail,
  isOpen,
  onOpenChange,
  onSuccess,
}: EditEmailDialogProps): JSX.Element | null {
  // Avoid initializing form/resolver until dialog is opened
  if (!isOpen) return null

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [newEmailAddress, setNewEmailAddress] = useState('')

  // Build schema using currentEmail (memoized to avoid re-creation on every render)
  const changeEmailSchema = makeChangeEmailSchema(currentEmail)

  const form = useForm<ChangeEmailFormValues>({
    resolver: standardSchemaResolver(changeEmailSchema),
    defaultValues: {
      newEmail: '',
    },
    mode: 'onTouched',
  })

  /**
   * Handle form submission
   */
  async function onSubmit(data: ChangeEmailFormValues) {
    setIsSubmitting(true)

    try {
      const result = await changeEmail({
        newEmail: data.newEmail,
      })

      if (result.error) {
        // Handle specific error cases
        if (result.error.message?.includes('already')) {
          toastError({
            title: 'Email already in use',
            description: 'This email is already associated with another account.',
          })
        } else if (result.error.message?.includes('rate')) {
          toastError({
            title: 'Too many attempts',
            description: 'Please wait a few minutes before trying again.',
          })
        } else {
          toastError({
            title: 'Failed to change email',
            description: result.error.message || 'Could not process email change request.',
          })
        }
        return
      }

      // Show success state
      setNewEmailAddress(data.newEmail)
      setShowSuccess(true)

      // Show success toast
      toastSuccess({
        title: 'Verification email sent',
        description: `Please check ${data.newEmail} for the verification link.`,
      })

      // Call success callback if provided
      onSuccess?.()

      // Close dialog after a delay
      setTimeout(() => {
        onOpenChange(false)
        // Reset state after dialog closes
        setTimeout(() => {
          setShowSuccess(false)
          setNewEmailAddress('')
          form.reset()
        }, 300)
      }, 3000)
    } catch (error) {
      console.error('Email change error:', error)
      toastError({
        title: 'Something went wrong',
        description: 'Failed to send verification email. Please try again.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  /**
   * Handle dialog open change
   */
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Reset form when closing
      form.reset()
      setShowSuccess(false)
      setNewEmailAddress('')
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Change Email Address</DialogTitle>
          <DialogDescription>
            Enter your new email address. We'll send a verification link to confirm the change.
          </DialogDescription>
        </DialogHeader>

        {showSuccess ? (
          <div className='space-y-4 py-4'>
            <Alert className='border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950'>
              <Mail className='size-4 text-green-600 dark:text-green-400' />
              <AlertDescription className='text-green-700 dark:text-green-300'>
                <strong>Verification email sent!</strong>
                <br />
                Please check your inbox at <strong>{newEmailAddress}</strong> and click the
                verification link to complete the email change.
              </AlertDescription>
            </Alert>
            <p className='text-sm text-muted-foreground'>
              The verification link will expire in 24 hours. If you don't receive the email, check
              your spam folder.
            </p>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
              {/* New Email Input */}
              <FormField
                control={form.control}
                name='newEmail'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Email</FormLabel>
                    <FormControl>
                      <InputGroup>
                        <InputGroupAddon align='inline-start'>
                          <Mail className='size-4 text-muted-foreground' />
                        </InputGroupAddon>
                        <InputGroupInput
                          type='email'
                          placeholder='Enter new email address'
                          autoComplete='email'
                          disabled={isSubmitting}
                          {...field}
                        />
                        <InputGroupAddon align='inline-end'>
                          {form.formState.errors.newEmail && (
                            <TooltipError text={form.formState.errors.newEmail.message ?? ''} />
                          )}
                        </InputGroupAddon>
                      </InputGroup>
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* Warning Message */}
              <Alert>
                <AlertCircle className='size-4' />
                <AlertDescription>
                  You will need to verify your new email address before the change takes effect.
                  Your current email will remain active until verification is complete.
                </AlertDescription>
              </Alert>

              <DialogFooter>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => handleOpenChange(false)}
                  disabled={isSubmitting}>
                  Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
                </Button>
                <Button
                  type='submit'
                  variant='outline'
                  size='sm'
                  loading={isSubmitting}
                  loadingText='Sending verification...'
                  disabled={!form.formState.isValid || isSubmitting}>
                  Send Verification <KbdSubmit variant='outline' size='sm' />
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
