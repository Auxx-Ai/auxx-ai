// src/app/(protected)/app/kb/_components/kb-tab-general.tsx
'use client'

import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import React, { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
} from '@auxx/ui/components/form'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { CheckIcon, MinusIcon, Loader2 } from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Switch } from '@auxx/ui/components/switch'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { api, type RouterOutputs } from '~/trpc/react'
import { ImagePreview } from '~/components/global/image-preview'
import { useFileSelect } from '~/components/file-select'
import { FileSelectPicker } from '~/components/pickers/file-select-picker'
type KBType = RouterOutputs['kb']['byId'] // Or adjust if using a combined type

import { toastError, toastSuccess } from '@auxx/ui/components/toast'

// Define a comprehensive schema based on KnowledgeBase model
const knowledgeBaseSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
  description: z.string().optional().nullable(),
  isPublic: z.boolean().default(false),
  customDomain: z.string().optional().nullable(),

  // Logo fields
  logoDark: z.string().optional().nullable(),
  logoLight: z.string().optional().nullable(),

  // Theme settings
  theme: z.enum(['clean', 'muted', 'gradient', 'bold']).default('clean'),
  showMode: z.boolean().default(true),
  defaultMode: z.enum(['light', 'dark']).default('light'),

  // Color scheme
  primaryColorLight: z.string().optional().nullable(),
  primaryColorDark: z.string().optional().nullable(),
  tintColorLight: z.string().optional().nullable(),
  tintColorDark: z.string().optional().nullable(),
  infoColorLight: z.string().optional().nullable(),
  infoColorDark: z.string().optional().nullable(),
  successColorLight: z.string().optional().nullable(),
  successColorDark: z.string().optional().nullable(),
  warningColorLight: z.string().optional().nullable(),
  warningColorDark: z.string().optional().nullable(),
  dangerColorLight: z.string().optional().nullable(),
  dangerColorDark: z.string().optional().nullable(),

  // UI styling
  fontFamily: z.string().optional().nullable(),
  iconsFamily: z.enum(['solid', 'regular', 'light']).default('regular'),
  cornerStyle: z.enum(['rounded', 'straight']).default('rounded'),
  sidebarListStyle: z.enum(['default', 'pill', 'line']).default('default'),
  searchbarPosition: z.enum(['center', 'corner']).default('center'),
})

export type KnowledgeBaseFormValues = z.infer<typeof knowledgeBaseSchema>
type GeneralTabProps = { knowledgeBaseId?: string; knowledgeBase: KBType }

export interface KBTabGeneralRef {
  submitForm: () => Promise<void> // Or return whatever your mutation returns/needs
}

function KBTabGeneral({ knowledgeBaseId, knowledgeBase }: GeneralTabProps) {
  // const params = useParams<{ id: string }>()
  // const knowledgeBaseId = params.id as string
  const [activeTab, setActiveTab] = useState<'light' | 'dark'>('light')
  const [isUploading, setIsUploading] = useState({ light: false, dark: false })

  // if (!knowledgeBase) {
  //   return null
  // }
  // Fetch existing knowledge base data
  // const { data: knowledgeBase, isLoading } = api.kb.byId.useQuery(
  //   { id: knowledgeBaseId },
  //   { enabled: !!knowledgeBaseId }
  // )

  // Update mutation
  const updateKnowledgeBase = api.kb.update.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Knowledge base settings updated successfully' })
    },
    onError: (error) => {
      toastError({ title: 'Failed to update knowledge base', description: error.message })
    },
  })

  // Form instance
  const form = useForm<KnowledgeBaseFormValues>({
    resolver: standardSchemaResolver(knowledgeBaseSchema),
    defaultValues: {
      name: knowledgeBase.name,
      slug: knowledgeBase.slug,
      description: knowledgeBase.description || '',
      isPublic: knowledgeBase.isPublic,
      customDomain: knowledgeBase.customDomain || '',
      logoDark: knowledgeBase.logoDark || '',
      logoLight: knowledgeBase.logoLight || '',
      theme: (knowledgeBase.theme as any) || 'clean',
      showMode: knowledgeBase.showMode,
      defaultMode: (knowledgeBase.defaultMode as any) || 'light',
      primaryColorLight: knowledgeBase.primaryColorLight || '#346DDB',
      primaryColorDark: knowledgeBase.primaryColorDark || '#346DDB',
      tintColorLight: knowledgeBase.tintColorLight || '#D7DEEC',
      tintColorDark: knowledgeBase.tintColorDark || '#010309',
      infoColorLight: knowledgeBase.infoColorLight || '#787878',
      infoColorDark: knowledgeBase.infoColorDark || '#787878',
      successColorLight: knowledgeBase.successColorLight || '#00C950',
      successColorDark: knowledgeBase.successColorDark || '#00C950',
      warningColorLight: knowledgeBase.warningColorLight || '#FE9A00',
      warningColorDark: knowledgeBase.warningColorDark || '#FE9A00',
      dangerColorLight: knowledgeBase.dangerColorLight || '#FB2C36',
      dangerColorDark: knowledgeBase.dangerColorDark || '#FB2C36',
      fontFamily: knowledgeBase.fontFamily || 'inter',
      iconsFamily: (knowledgeBase.iconsFamily as any) || 'regular',
      cornerStyle: (knowledgeBase.cornerStyle as any) || 'rounded',
      sidebarListStyle: (knowledgeBase.sidebarListStyle as any) || 'default',
      searchbarPosition: (knowledgeBase.searchbarPosition as any) || 'center',
    },
  })

  // Populate form when data is loaded
  useEffect(() => {
    console.log('Knowledge Base:', knowledgeBase)
    if (knowledgeBase) {
      // Reset form with existing data
      form.reset({
        name: knowledgeBase.name,
        slug: knowledgeBase.slug,
        description: knowledgeBase.description || '',
        isPublic: knowledgeBase.isPublic,
        customDomain: knowledgeBase.customDomain || '',
        logoDark: knowledgeBase.logoDark || '',
        logoLight: knowledgeBase.logoLight || '',
        theme: (knowledgeBase.theme as any) || 'clean',
        showMode: knowledgeBase.showMode,
        defaultMode: (knowledgeBase.defaultMode as any) || 'light',
        primaryColorLight: knowledgeBase.primaryColorLight || '#346DDB',
        primaryColorDark: knowledgeBase.primaryColorDark || '#346DDB',
        tintColorLight: knowledgeBase.tintColorLight || '#D7DEEC',
        tintColorDark: knowledgeBase.tintColorDark || '#010309',
        infoColorLight: knowledgeBase.infoColorLight || '#787878',
        infoColorDark: knowledgeBase.infoColorDark || '#787878',
        successColorLight: knowledgeBase.successColorLight || '#00C950',
        successColorDark: knowledgeBase.successColorDark || '#00C950',
        warningColorLight: knowledgeBase.warningColorLight || '#FE9A00',
        warningColorDark: knowledgeBase.warningColorDark || '#FE9A00',
        dangerColorLight: knowledgeBase.dangerColorLight || '#FB2C36',
        dangerColorDark: knowledgeBase.dangerColorDark || '#FB2C36',
        fontFamily: knowledgeBase.fontFamily || 'inter',
        iconsFamily: (knowledgeBase.iconsFamily as any) || 'regular',
        cornerStyle: (knowledgeBase.cornerStyle as any) || 'rounded',
        sidebarListStyle: (knowledgeBase.sidebarListStyle as any) || 'default',
        searchbarPosition: (knowledgeBase.searchbarPosition as any) || 'center',
      })
    }
  }, [knowledgeBase, form])

  // Form submission handler
  async function onSubmit(data: KnowledgeBaseFormValues) {
    if (!knowledgeBaseId) return

    await updateKnowledgeBase.mutateAsync({ id: knowledgeBaseId, data })
  }

  // Note: useImperativeHandle removed for React 19 compatibility
  // Methods can be accessed directly from the component instance if needed

  // Handle logo upload
  // FileSelect hooks for light/dark logo uploads (auto-start)
  const fileSelectLight = useFileSelect({
    entityType: 'KNOWLEDGE_BASE',
    entityId: knowledgeBaseId,
    allowMultiple: false,
    maxFiles: 1,
    autoStart: true,
    fileExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.svg'],
    sessionMetadata: { role: 'KB_LOGO', variant: 'light', title: 'kb-logo-light' },
    onUploadComplete: (files) => {
      const url = files?.[0]?.url || ''
      if (url) {
        form.setValue('logoLight', url)
        toastSuccess({ title: 'Light logo uploaded successfully' })
      }
    },
    onError: (error) => toastError({ title: 'Failed to upload light logo', description: error }),
  })

  const fileSelectDark = useFileSelect({
    entityType: 'KNOWLEDGE_BASE',
    entityId: knowledgeBaseId,
    allowMultiple: false,
    maxFiles: 1,
    autoStart: true,
    fileExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.svg'],
    sessionMetadata: { role: 'KB_LOGO', variant: 'dark', title: 'kb-logo-dark' },
    onUploadComplete: (files) => {
      const url = files?.[0]?.url || ''
      if (url) {
        form.setValue('logoDark', url)
        toastSuccess({ title: 'Dark logo uploaded successfully' })
      }
    },
    onError: (error) => toastError({ title: 'Failed to upload dark logo', description: error }),
  })

  const themes = [
    { value: 'clean', label: 'Clean', image: '/ui-light.png' },
    { value: 'muted', label: 'Muted', image: '/ui-dark.png' },
    { value: 'bold', label: 'Bold', image: '/ui-dark.png' },
    { value: 'gradient', label: 'Gradient', image: '/ui-dark.png' },
  ]

  const listStyles = [
    { value: 'default', label: 'Default', image: '/ui-light.png' },
    { value: 'pill', label: 'Pill', image: '/ui-dark.png' },
    { value: 'line', label: 'Line', image: '/ui-dark.png' },
  ]

  // if (isLoading) {
  //   return (
  //     <div className='flex h-full items-center justify-center p-8'>
  //       <Loader2 className='h-8 w-8 animate-spin text-primary' />
  //     </div>
  //   )
  // }

  return (
    <div className="relative p-4 pb-16">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="flex justify-end">
            {/* <Button
              type='submit'
              disabled={updateKnowledgeBase.isPending}
              className='mb-4'>
              {updateKnowledgeBase.isPending && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              Save Changes
            </Button> */}
          </div>
          {/* Basic */}
          <Card className="shadow-none">
            <CardHeader className="border-b py-4">
              <CardTitle className="font-normal">Basic</CardTitle>
            </CardHeader>
            <CardContent className="group/panel-body group-data-[variant=opened]/panel:bg-base group-data-[variant=opened]/panel:group-data-[kind=danger]/panel:border-danger flex flex-col gap-6 p-4 group-data-[variant=opened]/panel:rounded-lg group-data-[variant=opened]/panel:border">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="group/actionable-container flex min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                    <FormLabel>Title & Icon</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Overwrite the title and icon of your content when published.
                    </p>

                    <FormControl>
                      <Input {...field} placeholder="My Knowledge Base" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem className="group/actionable-container flex min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                    <FormLabel>URL Slug</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      This will be used in the URL of your knowledge base.
                    </p>

                    <FormControl>
                      <Input
                        {...field}
                        placeholder="my-knowledge-base"
                        disabled={updateKnowledgeBase.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="group/actionable-container flex min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                    <FormLabel>Description</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      A brief description of your knowledge base.
                    </p>

                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Enter a description..."
                        disabled={updateKnowledgeBase.isPending}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isPublic"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Public Access</FormLabel>
                      <FormDescription>
                        Allow anyone to access your knowledge base without authentication
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={updateKnowledgeBase.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="customDomain"
                render={({ field }) => (
                  <FormItem className="group/actionable-container flex min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                    <FormLabel>Custom Domain (Optional)</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Set a custom domain for your knowledge base.
                    </p>

                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ''}
                        placeholder="docs.example.com"
                        disabled={updateKnowledgeBase.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Logo Upload Fields */}
              <div className="space-y-3">
                <FormLabel>Custom Logo</FormLabel>
                <p className="text-sm text-muted-foreground">
                  Replace the content's title with a custom logo.
                  <br />
                  Recommended width: 600px or wider.
                </p>

                <div className="grid grid-cols-2 gap-6">
                  {/* Light Logo Upload */}
                  <div className="space-y-2">
                    <FormField
                      control={form.control}
                      name="logoLight"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Light Mode Logo</FormLabel>
                          <FormControl>
                            <div className="flex flex-col items-center space-y-2">
                              {field.value ? (
                                <div className="relative flex h-32 w-full items-center justify-center rounded-md border bg-white">
                                  <ImagePreview
                                    storageKey={field.value}
                                    alt="Light logo"
                                    className="max-h-24 max-w-full object-contain"
                                  />
                                </div>
                              ) : (
                                <div className="flex h-32 w-full items-center justify-center rounded-md border bg-white">
                                  <p className="text-sm text-muted-foreground">No logo uploaded</p>
                                </div>
                              )}
                              <div className="flex items-center">
                                <FileSelectPicker fileSelect={fileSelectLight}>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={updateKnowledgeBase.isPending}>
                                    {field.value ? 'Change Logo' : 'Upload Logo'}
                                  </Button>
                                </FileSelectPicker>
                                {field.value && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="ml-2 text-destructive"
                                    onClick={() => form.setValue('logoLight', '')}
                                    disabled={updateKnowledgeBase.isPending}>
                                    Remove
                                  </Button>
                                )}
                              </div>
                              <input type="hidden" {...field} value={field.value || ''} />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Dark Logo Upload */}
                  <div className="space-y-2">
                    <FormField
                      control={form.control}
                      name="logoDark"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Dark Mode Logo</FormLabel>
                          <FormControl>
                            <div className="flex flex-col items-center space-y-2">
                              {field.value ? (
                                <div className="relative flex h-32 w-full items-center justify-center rounded-md border bg-gray-800">
                                  <img
                                    src={field.value}
                                    alt="Dark logo"
                                    className="max-h-24 max-w-full object-contain"
                                  />
                                </div>
                              ) : (
                                <div className="flex h-32 w-full items-center justify-center rounded-md border bg-gray-800">
                                  <p className="text-sm text-gray-300">No logo uploaded</p>
                                </div>
                              )}
                              <div className="flex items-center">
                                <FileSelectPicker fileSelect={fileSelectDark}>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={updateKnowledgeBase.isPending}>
                                    {field.value ? 'Change Logo' : 'Upload Logo'}
                                  </Button>
                                </FileSelectPicker>
                                {field.value && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="ml-2 text-destructive"
                                    onClick={() => form.setValue('logoDark', '')}
                                    disabled={updateKnowledgeBase.isPending}>
                                    Remove
                                  </Button>
                                )}
                              </div>
                              <input type="hidden" {...field} value={field.value || ''} />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          {/* Themes */}
          <Card className="shadow-none">
            <CardHeader className="border-b py-4">
              <CardTitle className="font-normal">Themes</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 p-4">
              <FormField
                control={form.control}
                name="theme"
                render={({ field }) => (
                  <FormItem className="group/actionable-container flex min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                    <FormControl>
                      <RadioGroup
                        className="relative grid w-full grid-cols-2 gap-5"
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={updateKnowledgeBase.isPending}>
                        {themes.map((item) => (
                          <label key={`theme-${item.value}`}>
                            <RadioGroupItem
                              id={`theme-${item.value}`}
                              value={item.value}
                              className="peer sr-only after:absolute after:inset-0"
                            />
                            <img
                              src={item.image}
                              alt={item.label}
                              width={88}
                              height={70}
                              className="shadow-2xs peer-data-disabled:cursor-not-allowed peer-data-disabled:opacity-50 border-transparentpeer-data-[state=checked]:bg-accent relative w-full cursor-pointer overflow-hidden rounded-md border border-2 border-input outline-hidden transition-[color,box-shadow] peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-data-[state=checked]:border-ring"
                            />
                            <span className="group mt-2 flex items-center gap-1 peer-data-[state=unchecked]:text-muted-foreground/70">
                              <CheckIcon
                                size={16}
                                className="group-peer-data-[state=unchecked]:hidden"
                                aria-hidden="true"
                              />
                              <span className="text-xs font-medium">{item.label}</span>
                            </span>
                          </label>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Tabs
                defaultValue={activeTab}
                onValueChange={(v) => setActiveTab(v as 'light' | 'dark')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="light">Light mode</TabsTrigger>
                  <TabsTrigger value="dark">Dark mode</TabsTrigger>
                </TabsList>
                <TabsContent value="light">
                  <div className="flex flex-col gap-4">
                    <FormField
                      control={form.control}
                      name="primaryColorLight"
                      render={({ field }) => (
                        <FormItem className="group/actionable-container flex grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] flex-col gap-x-4 gap-y-2">
                          <div>
                            <FormLabel>Primary Color</FormLabel>

                            <p className="text-sm text-muted-foreground">
                              Used for main elements such as buttons and links
                            </p>
                          </div>

                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ''}
                              placeholder="#3B82F6"
                              className="w-[100px]"
                              type="color"
                              disabled={updateKnowledgeBase.isPending}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="tintColorLight"
                      render={({ field }) => (
                        <FormItem className="group/actionable-container flex grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] flex-col gap-x-4 gap-y-2">
                          <div>
                            <FormLabel>Tint Color</FormLabel>

                            <p className="text-sm text-muted-foreground">
                              Add some color to the background and secondary elements. Try out some
                              of the suggested colors below.
                            </p>
                          </div>

                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ''}
                              placeholder="#EFF6FF"
                              className="w-[100px]"
                              type="color"
                              disabled={updateKnowledgeBase.isPending}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div>
                      <h2 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        Semantic colors
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Used to quickly convey meaning in elements across your site.
                      </p>
                    </div>
                    <div className="flex flex-row gap-4">
                      <FormField
                        control={form.control}
                        name="infoColorLight"
                        render={({ field }) => (
                          <FormItem className="group/actionable-container flex grid min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                            <FormLabel>Info</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ''}
                                placeholder="#3B82F6"
                                type="color"
                                disabled={updateKnowledgeBase.isPending}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="successColorLight"
                        render={({ field }) => (
                          <FormItem className="group/actionable-container flex grid min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                            <FormLabel>Success</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ''}
                                placeholder="#10B981"
                                type="color"
                                disabled={updateKnowledgeBase.isPending}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="warningColorLight"
                        render={({ field }) => (
                          <FormItem className="group/actionable-container flex grid min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                            <FormLabel>Warning</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ''}
                                placeholder="#F59E0B"
                                type="color"
                                disabled={updateKnowledgeBase.isPending}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="dangerColorLight"
                        render={({ field }) => (
                          <FormItem className="group/actionable-container flex grid min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                            <FormLabel>Danger</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ''}
                                placeholder="#EF4444"
                                type="color"
                                disabled={updateKnowledgeBase.isPending}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="dark">
                  <div className="flex flex-col gap-4">
                    <FormField
                      control={form.control}
                      name="primaryColorDark"
                      render={({ field }) => (
                        <FormItem className="group/actionable-container flex grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] flex-col gap-x-4 gap-y-2">
                          <div>
                            <FormLabel>Primary Color</FormLabel>

                            <p className="text-sm text-muted-foreground">
                              Used for main elements such as buttons and links
                            </p>
                          </div>

                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ''}
                              placeholder="#60A5FA"
                              className="w-[100px]"
                              type="color"
                              disabled={updateKnowledgeBase.isPending}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="tintColorDark"
                      render={({ field }) => (
                        <FormItem className="group/actionable-container flex grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] flex-col gap-x-4 gap-y-2">
                          <div>
                            <FormLabel>Tint Color</FormLabel>

                            <p className="text-sm text-muted-foreground">
                              Add some color to the background and secondary elements. Try out some
                              of the suggested colors below.
                            </p>
                          </div>

                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ''}
                              placeholder="#1F2937"
                              className="w-[100px]"
                              type="color"
                              disabled={updateKnowledgeBase.isPending}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div>
                      <h2 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        Semantic colors
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Used to quickly convey meaning in elements across your site.
                      </p>
                    </div>
                    <div className="flex flex-row gap-4">
                      <FormField
                        control={form.control}
                        name="infoColorDark"
                        render={({ field }) => (
                          <FormItem className="group/actionable-container flex grid min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                            <FormLabel>Info</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ''}
                                placeholder="#93C5FD"
                                type="color"
                                disabled={updateKnowledgeBase.isPending}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="successColorDark"
                        render={({ field }) => (
                          <FormItem className="group/actionable-container flex grid min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                            <FormLabel>Success</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ''}
                                placeholder="#34D399"
                                type="color"
                                disabled={updateKnowledgeBase.isPending}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="warningColorDark"
                        render={({ field }) => (
                          <FormItem className="group/actionable-container flex grid min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                            <FormLabel>Warning</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ''}
                                placeholder="#FBBF24"
                                type="color"
                                disabled={updateKnowledgeBase.isPending}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="dangerColorDark"
                        render={({ field }) => (
                          <FormItem className="group/actionable-container flex grid min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                            <FormLabel>Danger</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ''}
                                placeholder="#F87171"
                                type="color"
                                disabled={updateKnowledgeBase.isPending}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
          {/* Modes */}
          <Card className="shadow-none">
            <CardHeader className="border-b py-4">
              <CardTitle className="font-normal">Modes</CardTitle>
            </CardHeader>
            <CardContent className="group/panel-body group-data-[variant=opened]/panel:bg-base group-data-[variant=opened]/panel:group-data-[kind=danger]/panel:border-danger flex flex-col gap-6 p-4 group-data-[variant=opened]/panel:rounded-lg group-data-[variant=opened]/panel:border">
              <FormField
                control={form.control}
                name="showMode"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Show Theme Switcher</FormLabel>
                      <FormDescription>
                        Allow users to switch between light and dark mode
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={updateKnowledgeBase.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="defaultMode"
                render={({ field }) => (
                  <FormItem className="group/actionable-container flex grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] flex-col gap-x-4 gap-y-2">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Default mode</FormLabel>
                      <FormDescription>
                        All your viewers will see this mode by default
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={updateKnowledgeBase.isPending}>
                        <SelectTrigger className="w-full h-8 py-1">
                          <SelectValue placeholder="Pick..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Mode</SelectLabel>
                            <SelectItem value="dark">Dark</SelectItem>
                            <SelectItem value="light">Light</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
          {/* Site styles */}
          <Card className="shadow-none">
            <CardHeader className="border-b py-4">
              <CardTitle className="font-normal">Site styles</CardTitle>
            </CardHeader>
            <CardContent className="group/panel-body group-data-[variant=opened]/panel:bg-base group-data-[variant=opened]/panel:group-data-[kind=danger]/panel:border-danger flex flex-col gap-6 p-4 group-data-[variant=opened]/panel:rounded-lg group-data-[variant=opened]/panel:border">
              <FormField
                control={form.control}
                name="fontFamily"
                render={({ field }) => (
                  <FormItem className="group/actionable-container flex grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] flex-col gap-x-4 space-y-0">
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-base">Font Family</FormLabel>
                    </div>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value || ''}
                        disabled={updateKnowledgeBase.isPending}
                        className="mt-0">
                        <SelectTrigger className="w-full h-8 py-1">
                          <SelectValue placeholder="System Default" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Font</SelectLabel>
                            <SelectItem value="default">System Default</SelectItem>
                            <SelectItem value="inter">Inter</SelectItem>
                            <SelectItem value="roboto">Roboto</SelectItem>
                            <SelectItem value="opensans">Open Sans</SelectItem>
                            <SelectItem value="montserrat">Montserrat</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="iconsFamily"
                render={({ field }) => (
                  <FormItem className="group/actionable-container flex grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] flex-col gap-x-4 space-y-0">
                    <div className="flex flex-row items-center justify-between">
                      <FormLabel className="text-base">Icons</FormLabel>
                    </div>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={updateKnowledgeBase.isPending}>
                        <SelectTrigger className="w-full h-8 py-1">
                          <SelectValue placeholder="Pick..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Style</SelectLabel>
                            <SelectItem value="solid">Solid</SelectItem>
                            <SelectItem value="regular">Regular</SelectItem>
                            <SelectItem value="light">Light</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cornerStyle"
                render={({ field }) => (
                  <FormItem className="group/actionable-container flex grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] flex-col gap-x-4 space-y-0">
                    <div className="flex flex-row items-center justify-between">
                      <FormLabel className="text-base">Corner Style</FormLabel>
                    </div>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={updateKnowledgeBase.isPending}>
                        <SelectTrigger className="w-full h-8 py-1">
                          <SelectValue placeholder="Pick..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Corner Style</SelectLabel>
                            <SelectItem value="rounded">Rounded</SelectItem>
                            <SelectItem value="straight">Straight</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="searchbarPosition"
                render={({ field }) => (
                  <FormItem className="group/actionable-container flex grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] flex-col gap-x-4 space-y-0">
                    <div className="flex flex-row items-center justify-between">
                      <FormLabel className="text-base">Search Bar Position</FormLabel>
                    </div>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={updateKnowledgeBase.isPending}>
                        <SelectTrigger className="w-full h-8 py-1">
                          <SelectValue placeholder="Pick..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Position</SelectLabel>
                            <SelectItem value="center">Center</SelectItem>
                            <SelectItem value="corner">Corner</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
          {/* Sidebar styles */}
          <Card className="shadow-none">
            <CardHeader className="border-b py-4">
              <CardTitle className="font-normal">Sidebar Style</CardTitle>
            </CardHeader>
            <CardContent className="group/panel-body group-data-[variant=opened]/panel:bg-base group-data-[variant=opened]/panel:group-data-[kind=danger]/panel:border-danger flex flex-col gap-6 p-4 group-data-[variant=opened]/panel:rounded-lg group-data-[variant=opened]/panel:border">
              <FormField
                control={form.control}
                name="sidebarListStyle"
                render={({ field }) => (
                  <FormItem className="group/actionable-container flex min-w-0 flex-1 flex-col gap-x-4 gap-y-2">
                    <FormLabel>List style</FormLabel>
                    <FormDescription>Choose sidebar list and selected items style</FormDescription>
                    <FormControl>
                      <RadioGroup
                        className="relative grid w-full grid-cols-3 gap-3"
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={updateKnowledgeBase.isPending}>
                        {listStyles.map((item) => (
                          <label key={`list-style-${item.value}`}>
                            <RadioGroupItem
                              id={`list-style-${item.value}`}
                              value={item.value}
                              className="peer sr-only after:absolute after:inset-0"
                            />
                            <img
                              src={item.image}
                              alt={item.label}
                              width={88}
                              height={70}
                              className="shadow-2xs peer-data-disabled:cursor-not-allowed peer-data-disabled:opacity-50 relative w-full cursor-pointer overflow-hidden rounded-md border border-input outline-hidden transition-[color,box-shadow] peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-data-[state=checked]:border-ring peer-data-[state=checked]:bg-accent"
                            />
                            <span className="group mt-2 flex items-center gap-1 peer-data-[state=unchecked]:text-muted-foreground/70">
                              <CheckIcon
                                size={16}
                                className="group-peer-data-[state=unchecked]:hidden"
                                aria-hidden="true"
                              />
                              <MinusIcon
                                size={16}
                                className="group-peer-data-[state=checked]:hidden"
                                aria-hidden="true"
                              />
                              <span className="text-xs font-medium">{item.label}</span>
                            </span>
                          </label>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
          {/* <div className='absolute bottom-0 right-0'>
            <Button type='submit' disabled={updateKnowledgeBase.isPending}>
              {updateKnowledgeBase.isPending && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              Save Changes
            </Button>
          </div> */}
        </form>
      </Form>
    </div>
  )
}

export default KBTabGeneral
