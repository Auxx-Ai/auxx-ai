// apps/build/src/components/apps/app-update-form.tsx
'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
// import { zodResolver } from '@hookform/resolvers/zod'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
  BarChart3,
  Bot,
  CreditCard,
  Phone,
  Headphones,
  MessageSquare,
  ClipboardList,
  Package,
} from 'lucide-react'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '@auxx/ui/components/field'
import { constants } from '@auxx/config/client'
import { api } from '~/trpc/react'
import { toastError } from '~/components/global/toast'
import { useBuildDehydratedState } from '~/components/providers/dehydrated-state-provider'

/** Icon mapping for app categories */
const iconMap = {
  BarChart3,
  Bot,
  CreditCard,
  Phone,
  Headphones,
  MessageSquare,
  ClipboardList,
  Package,
} as const

/** Form validation schema */
const appUpdateSchema = z.object({
  title: z.string().min(1, 'App name is required'),
  description: z.string().optional().or(z.literal('')),
  category: z
    .enum(constants.appCategories.map((c) => c.value) as [string, ...string[]])
    .nullable()
    .optional(),
  contentOverview: z
    .string()
    .refine((val) => !val || val.length === 0 || val.length >= 100, {
      message: 'Overview must be at least 100 characters',
    })
    .refine((val) => !val || val.length <= 3000, {
      message: 'Overview must be less than 3000 characters',
    })
    .optional()
    .or(z.literal('')),
  contentHowItWorks: z
    .string()
    .refine((val) => !val || val.length === 0 || val.length >= 100, {
      message: 'How it works must be at least 100 characters',
    })
    .refine((val) => !val || val.length <= 3000, {
      message: 'How it works must be less than 3000 characters',
    })
    .optional()
    .or(z.literal('')),
  contentConfigure: z
    .string()
    .refine((val) => !val || val.length === 0 || val.length >= 100, {
      message: 'Configuration must be at least 100 characters',
    })
    .refine((val) => !val || val.length <= 3000, {
      message: 'Configuration must be less than 3000 characters',
    })
    .optional()
    .or(z.literal('')),
  websiteUrl: z
    .string()
    .refine((val) => !val || val === '' || z.string().url().safeParse(val).success, {
      message: 'Must be a valid URL',
    })
    .optional()
    .or(z.literal('')),
  documentationUrl: z
    .string()
    .refine((val) => !val || val === '' || z.string().url().safeParse(val).success, {
      message: 'Must be a valid URL',
    })
    .optional()
    .or(z.literal('')),
  contactUrl: z.string().optional().or(z.literal('')),
  supportSiteUrl: z
    .string()
    .refine((val) => !val || val === '' || z.string().url().safeParse(val).success, {
      message: 'Must be a valid URL',
    })
    .optional()
    .or(z.literal('')),
  termsOfServiceUrl: z
    .string()
    .refine((val) => !val || val === '' || z.string().url().safeParse(val).success, {
      message: 'Must be a valid URL',
    })
    .optional()
    .or(z.literal('')),
})

type AppUpdateFormData = z.infer<typeof appUpdateSchema>

interface AppUpdateFormProps {
  appSlug: string
}

/**
 * App update form component
 * Uses dehydrated state for instant render
 */
export function AppUpdateForm({ appSlug }: AppUpdateFormProps) {
  const utils = api.useUtils()
  const { apps } = useBuildDehydratedState()

  // Find the app from dehydrated state (instant, no API call)
  const app = apps.find((a) => a.slug === appSlug)

  // Fetch full app details if needed (includes fields not in dehydrated state)
  const { data: fullApp, isLoading } = api.apps.get.useQuery(
    { slug: appSlug },
    {
      enabled: !!app, // Only fetch if app exists in dehydrated state
      initialData: app as any, // Use dehydrated data as initial data
    }
  )
  console.log('full app', fullApp)
  // Update mutation
  const updateApp = api.apps.update.useMutation({
    onSuccess: () => {
      // Invalidate and refetch
      utils.apps.get.invalidate({ slug: appSlug })
      // Note: router.refresh() not needed here since we're staying on the same page
      // and the tRPC invalidation will refetch the data
    },
  })

  // Form setup
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    setValue,
    watch,
    setError,
  } = useForm<AppUpdateFormData>({
    resolver: standardSchemaResolver(appUpdateSchema),
    defaultValues: {
      title: '',
      description: '',
      category: undefined,
      contentOverview: '',
      contentHowItWorks: '',
      contentConfigure: '',
      websiteUrl: '',
      documentationUrl: '',
      contactUrl: '',
      supportSiteUrl: '',
      termsOfServiceUrl: '',
    },
  })

  // Update form when app data loads (instant with dehydrated data)
  useEffect(() => {
    if (fullApp) {
      reset({
        title: fullApp.title,
        description: fullApp.description || '',
        category: fullApp.category as any,
        contentOverview: fullApp.contentOverview || '',
        contentHowItWorks: fullApp.contentHowItWorks || '',
        contentConfigure: fullApp.contentConfigure || '',
        websiteUrl: fullApp.websiteUrl || '',
        documentationUrl: fullApp.documentationUrl || '',
        contactUrl: fullApp.contactUrl || '',
        supportSiteUrl: fullApp.supportSiteUrl || '',
        termsOfServiceUrl: fullApp.termsOfServiceUrl || '',
      })
    }
  }, [fullApp, reset])

  // Form submission
  const onSubmit = async (data: AppUpdateFormData) => {
    if (!fullApp) return

    try {
      const result = await updateApp.mutateAsync({
        id: fullApp.id,
        ...data,
      })
    } catch (error) {
      const fieldErrors = error?.data?.fieldErrors

      if (fieldErrors && Object.keys(fieldErrors).length) {
        // Set field-specific errors
        Object.entries(fieldErrors).forEach(([field, message]) => {
          setError(field as keyof AppUpdateFormData, {
            type: 'manual',
            message,
          })
        })

        toastError({
          title: 'Validation failed',
          description: 'Please check the form for errors',
        })
      }
    }
  }

  // Use dehydrated data first, then upgrade to full data
  const displayApp = fullApp || app

  return (
    <div className="flex flex-col items-center justify-start gap-1 py-10 px-4 overflow-y-auto">
      <div className="max-w-3xl w-full mx-auto">
        <form onSubmit={handleSubmit(onSubmit)}>
          <FieldGroup>
            {/* Basic Information Section */}
            <FieldSet>
              <FieldLegend>Basic Information</FieldLegend>
              <FieldDescription>
                Update your app's basic information and marketplace details
              </FieldDescription>
              <FieldGroup>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="app-name">Name</FieldLabel>
                    <Input
                      id="app-name"
                      type="text"
                      {...register('title')}
                      placeholder="My Awesome App"
                    />
                    {errors.title && (
                      <p className="text-sm text-red-600 mt-1">{errors.title.message}</p>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="slug">Slug</FieldLabel>
                    <Input id="slug" type="text" value={displayApp.slug} disabled />
                    <FieldDescription>Slug cannot be changed after creation</FieldDescription>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="app-tagline">Tagline</FieldLabel>
                  <Input
                    id="app-tagline"
                    placeholder="Enter a brief tagline"
                    {...register('description')}
                  />
                  {errors.description && (
                    <p className="text-sm text-red-600 mt-1">{errors.description.message}</p>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="app-category">Category</FieldLabel>
                  <Select
                    value={watch('category')}
                    onValueChange={(value) =>
                      setValue('category', value as any, { shouldDirty: true })
                    }>
                    <SelectTrigger id="app-category">
                      <SelectValue placeholder="Select a category..." />
                    </SelectTrigger>
                    <SelectContent>
                      {constants.appCategories.map((category) => {
                        const Icon = iconMap[category.icon as keyof typeof iconMap]
                        return (
                          <SelectItem key={category.value} value={category.value}>
                            <div className="flex items-center gap-2">
                              {Icon && <Icon className="size-4" />}
                              <span>{category.label}</span>
                            </div>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                  {errors.category && (
                    <p className="text-sm text-red-600 mt-1">{errors.category.message}</p>
                  )}
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSeparator />

            {/* Listing Content Section */}
            <FieldSet>
              <FieldLegend>Listing content</FieldLegend>
              <FieldDescription>
                Describe your app for the marketplace (100-3000 characters each)
              </FieldDescription>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="app-overview">Overview</FieldLabel>
                  <Textarea
                    id="app-overview"
                    placeholder="Describe what your app does..."
                    rows={6}
                    {...register('contentOverview')}
                  />
                  {errors.contentOverview && (
                    <p className="text-sm text-red-600 mt-1">{errors.contentOverview.message}</p>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="app-how-it-works">How it works</FieldLabel>
                  <Textarea
                    id="app-how-it-works"
                    placeholder="Explain how your app works..."
                    rows={6}
                    {...register('contentHowItWorks')}
                  />
                  {errors.contentHowItWorks && (
                    <p className="text-sm text-red-600 mt-1">{errors.contentHowItWorks.message}</p>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="app-configurations">Configuration</FieldLabel>
                  <Textarea
                    id="app-configurations"
                    placeholder="Explain how to configure your app..."
                    rows={6}
                    {...register('contentConfigure')}
                  />
                  {errors.contentConfigure && (
                    <p className="text-sm text-red-600 mt-1">{errors.contentConfigure.message}</p>
                  )}
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSeparator />

            {/* Links Section */}
            <FieldSet>
              <FieldLegend>Links</FieldLegend>
              <FieldDescription>Provide links to your app's resources</FieldDescription>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="app-website">Website</FieldLabel>
                  <Input
                    id="app-website"
                    placeholder="https://example.com"
                    {...register('websiteUrl')}
                  />
                  {errors.websiteUrl && (
                    <p className="text-sm text-red-600 mt-1">{errors.websiteUrl.message}</p>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="app-documentation">Documentation</FieldLabel>
                  <Input
                    id="app-documentation"
                    placeholder="https://docs.example.com"
                    {...register('documentationUrl')}
                  />
                  {errors.documentationUrl && (
                    <p className="text-sm text-red-600 mt-1">{errors.documentationUrl.message}</p>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="app-support-contact">Support contact</FieldLabel>
                  <Input
                    id="app-support-contact"
                    placeholder="support@example.com"
                    {...register('contactUrl')}
                  />
                  {errors.contactUrl && (
                    <p className="text-sm text-red-600 mt-1">{errors.contactUrl.message}</p>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="app-terms">Terms of Service</FieldLabel>
                  <Input
                    id="app-terms"
                    placeholder="https://example.com/terms"
                    {...register('termsOfServiceUrl')}
                  />
                  {errors.termsOfServiceUrl && (
                    <p className="text-sm text-red-600 mt-1">{errors.termsOfServiceUrl.message}</p>
                  )}
                </Field>
              </FieldGroup>
            </FieldSet>

            {/* Submit Button */}
            <Field orientation="horizontal">
              <Button
                type="submit"
                size="sm"
                loading={updateApp.isPending}
                loadingText="Saving..."
                disabled={!isDirty || updateApp.isPending}>
                Save Changes
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </div>
    </div>
  )
}
