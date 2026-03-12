// apps/build/src/components/apps/create-app-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import { Spinner } from '@auxx/ui/components/spinner'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { toastError } from '~/components/global/toast'
import { useAddApp } from '~/components/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

/** Slugify helper function */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const createAppSchema = z.object({
  title: z
    .string()
    .min(1, 'App name is required')
    .max(255, 'App name must be less than 255 characters'),
  slug: z.string().min(3, 'Slug must be at least 3 characters'),
})

type CreateAppForm = z.infer<typeof createAppSchema>

interface CreateAppDialogProps {
  /** Developer account slug */
  accountSlug: string
  /** Optional custom trigger element */
  trigger?: React.ReactNode
  /** Optional callback on successful app creation */
  onSuccess?: (app: any) => void
}

/**
 * Dialog for creating a new app
 * Provides form with app name and slug fields
 * Includes real-time slug availability checking
 */
export function CreateAppDialog({ accountSlug, trigger, onSuccess }: CreateAppDialogProps) {
  const [open, setOpen] = useState(false)
  const [slugTouched, setSlugTouched] = useState(false)
  const router = useRouter()

  const form = useForm<CreateAppForm>({
    resolver: standardSchemaResolver(createAppSchema),
    defaultValues: {
      title: '',
      slug: '',
    },
  })

  const titleValue = form.watch('title')
  const slugValue = form.watch('slug')

  // Auto-generate slug from title
  useEffect(() => {
    if (!slugTouched && titleValue) {
      form.setValue('slug', slugify(titleValue))
    }
  }, [titleValue, slugTouched, form])

  const utils = api.useUtils()
  const addApp = useAddApp()

  // Check if slug exists (debounced)
  const { data: slugCheck, isLoading: isCheckingSlug } = api.apps.slugExists.useQuery(
    { slug: slugValue || '' },
    {
      enabled: slugValue.length >= 3 && open,
      retry: false,
    }
  )

  const createApp = api.apps.create.useMutation({
    onSuccess: (data) => {
      // Add new app to dehydrated state immediately
      addApp({
        id: data.app.id,
        developerAccountId: data.app.developerAccountId,
        slug: data.app.slug,
        title: data.app.title,
        description: data.app.description ?? null,
        avatarId: null,
        avatarUrl: null,
        category: null,
        websiteUrl: null,
        documentationUrl: null,
        contactUrl: null,
        supportSiteUrl: null,
        termsOfServiceUrl: null,
        overview: null,
        contentOverview: null,
        contentHowItWorks: null,
        contentConfigure: null,
        scopes: null,
        hasOauth: false,
        oauthExternalEntrypointUrl: null,
        hasBundle: false,
        publicationStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Invalidate developer account's first app query
      utils.developerAccounts.getFirstApp.invalidate({ slug: accountSlug })

      // Reset form and close dialog
      form.reset()
      setOpen(false)
      setSlugTouched(false)

      // Call success callback
      onSuccess?.(data.app)

      // Navigate to the new app
      router.push(`/${accountSlug}/apps/${data.app.slug}`)
    },
    onError: (error) => {
      toastError({
        title: 'Failed to create app',
        description: error.message,
      })
    },
  })

  const onSubmit = (data: CreateAppForm) => {
    // Additional validation
    if (slugCheck?.exists) {
      toastError({ title: 'This slug is already taken' })
      return
    }

    createApp.mutate({
      title: data.title,
      slug: data.slug,
      developerSlug: accountSlug,
    })
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      form.reset()
      setSlugTouched(false)
    }
  }

  const slugValid = slugValue.length >= 3 && !slugCheck?.exists
  const slugError = slugCheck?.exists ? 'This slug is already taken' : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size='sm'>
            <Plus />
            Create App
          </Button>
        )}
      </DialogTrigger>
      <DialogContent position='tc' size='sm'>
        <DialogHeader>
          <DialogTitle>Create New App</DialogTitle>
          <DialogDescription>
            Create a new app for your developer account. The slug is a unique identifier for your
            app.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='title'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>App Name *</FormLabel>
                  <FormControl>
                    <Input placeholder='Evil Rabbit' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='slug'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug *</FormLabel>
                  <FormControl>
                    <InputGroup>
                      <InputGroupInput
                        placeholder='evil-rabbit'
                        {...field}
                        onChange={(e) => {
                          field.onChange(slugify(e.target.value))
                          setSlugTouched(true)
                        }}
                      />
                      {slugValue.length >= 3 && (
                        <InputGroupAddon align='inline-end'>
                          {isCheckingSlug ? (
                            <Spinner />
                          ) : slugValid ? (
                            <span className='text-green-600'>✓</span>
                          ) : slugError ? (
                            <span className='text-red-600'>✗</span>
                          ) : null}
                        </InputGroupAddon>
                      )}
                    </InputGroup>
                  </FormControl>
                  {slugError && <p className='text-sm text-red-600 mt-1'>{slugError}</p>}
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => setOpen(false)}
                disabled={createApp.isPending}>
                Cancel
              </Button>
              <Button
                variant='outline'
                size='sm'
                type='submit'
                loading={createApp.isPending}
                loadingText='Creating...'
                disabled={
                  !titleValue ||
                  !slugValue ||
                  slugValue.length < 3 ||
                  slugCheck?.exists ||
                  isCheckingSlug
                }>
                Create App
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
