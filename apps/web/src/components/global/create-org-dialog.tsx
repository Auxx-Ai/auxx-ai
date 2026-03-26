// src/components/organization-switcher.tsx
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Check, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { client as authClient } from '~/auth/auth-client'
import { clearChannelCaches } from '~/components/channels/providers/channel-provider'
import { clearResourceCaches } from '~/components/resources'
import { api } from '~/trpc/react'

const formSchema = z.object({
  name: z.string().min(1, { error: 'Organization name is required' }),
  handle: z
    .string()
    .min(4, { error: 'Handle must be at least 4 characters' })
    .regex(/^[a-z0-9-]+$/, {
      error: 'Handle can only contain lowercase letters, numbers, and hyphens',
    }),
  website: z.url().optional().or(z.literal('')),
})

interface CreateOrganizationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * CreateOrganizationDialog allows users to create a new organization with:
 * - Organization name
 * - Auto-generated handle (with manual override)
 * - Real-time handle availability checking
 * - Optional website URL
 */
export function CreateOrganizationDialog({ open, onOpenChange }: CreateOrganizationDialogProps) {
  const [handleAvailable, setHandleAvailable] = useState<boolean | null>(null)
  const [handleManuallyEdited, setHandleManuallyEdited] = useState(false)
  const [debouncedHandle, setDebouncedHandle] = useState('')

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: standardSchemaResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      handle: '',
      website: '',
    },
  })

  const watchName = form.watch('name')
  const watchHandle = form.watch('handle')

  // Auto-generate handle from name
  const generateHandle = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  // Auto-generate handle when name changes (only if not manually edited)
  // biome-ignore lint/correctness/useExhaustiveDependencies: generateHandle is a stable local function
  useEffect(() => {
    if (watchName && !handleManuallyEdited) {
      form.setValue('handle', generateHandle(watchName), { shouldValidate: true })
    }
  }, [watchName, handleManuallyEdited, form])

  // Debounce handle changes for API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedHandle(watchHandle || '')
    }, 500)
    return () => clearTimeout(timer)
  }, [watchHandle])

  // Check handle availability
  const { data: availabilityData, isLoading: isCheckingAvailability } =
    api.organization.checkHandleAvailability.useQuery(
      { handle: debouncedHandle },
      {
        enabled: debouncedHandle.length >= 4,
        refetchOnWindowFocus: false,
      }
    )

  // Update availability state
  useEffect(() => {
    if (!debouncedHandle || debouncedHandle.length < 4) {
      setHandleAvailable(null)
      return
    }

    if (availabilityData !== undefined) {
      const isAvailable = availabilityData.available
      setHandleAvailable(isAvailable)

      if (isAvailable) {
        form.clearErrors('handle')
      } else {
        form.setError('handle', { message: 'This handle is already taken' })
      }
    }
  }, [availabilityData, debouncedHandle, form])

  const createOrganization = api.organization.create.useMutation({
    onSuccess: async () => {
      // Close dialog
      onOpenChange(false)

      // Reset form
      form.reset()
      setHandleManuallyEdited(false)
      setHandleAvailable(null)

      // Clear client-side caches before navigation
      clearResourceCaches()
      clearChannelCaches()

      // Force session cache refresh to get updated defaultOrganizationId
      await authClient.getSession({ query: { disableCookieCache: true } })

      // Full navigation to onboarding — server will fetch fresh dehydrated state
      // with the new org already set as default
      window.location.href = '/onboarding'
    },
    onError: (error) => {
      toastError({
        title: 'Failed to create organization',
        description: error.message,
      })
    },
  })

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    // Final check for handle availability
    if (handleAvailable === false) {
      form.setError('handle', { message: 'This handle is already taken' })
      return
    }

    // Ensure we've checked the handle
    if (values.handle !== debouncedHandle) {
      toastError({
        title: 'Error',
        description: 'Please wait for handle availability check to complete.',
      })
      return
    }

    createOrganization.mutate({
      name: values.name,
      handle: values.handle,
      type: 'TEAM',
      website: values.website || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[425px]'>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Create a new organization to collaborate with your team.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            {/* Organization Name */}
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organization Name</FormLabel>
                  <FormControl>
                    <Input placeholder='Acme Corp' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Organization Handle */}
            <FormField
              control={form.control}
              name='handle'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organization Handle</FormLabel>
                  <FormControl>
                    <div className='relative'>
                      <InputGroup>
                        <InputGroupAddon align='inline-start'>
                          <InputGroupText>auxx.ai /</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          placeholder='acme-corp'
                          {...field}
                          onFocus={() => {
                            if (watchHandle) {
                              setHandleManuallyEdited(true)
                            }
                          }}
                          onChange={(e) => {
                            setHandleManuallyEdited(true)
                            field.onChange(e)
                          }}
                          className='pr-10'
                        />
                      </InputGroup>
                      {watchHandle && watchHandle.length >= 4 && (
                        <div className='absolute right-3 top-1/2 -translate-y-1/2'>
                          {isCheckingAvailability ? (
                            <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
                          ) : handleAvailable === true ? (
                            <Check className='h-4 w-4 text-green-500' />
                          ) : handleAvailable === false ? (
                            <X className='h-4 w-4 text-destructive' />
                          ) : null}
                        </div>
                      )}
                    </div>
                  </FormControl>
                  <FormDescription>This will be used in your public URLs</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Website */}
            <FormField
              control={form.control}
              name='website'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder='https://example.com' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                onClick={() => onOpenChange(false)}
                variant='ghost'
                size='sm'
                type='button'
                disabled={createOrganization.isPending}>
                Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              <Button
                type='submit'
                variant='outline'
                size='sm'
                disabled={
                  !form.formState.isValid ||
                  isCheckingAvailability ||
                  handleAvailable === false ||
                  createOrganization.isPending
                }
                loading={createOrganization.isPending}
                loadingText='Creating...'>
                Create <KbdSubmit variant='outline' size='sm' />
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
