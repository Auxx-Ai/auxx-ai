// ~/app/(protected)/app/settings/channels/_components/chat-widget-settings.tsx
'use client'
import { widgetSchema as chatWidgetInputSchema } from '@auxx/lib/widgets/types'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { CopyButton } from '@auxx/ui/components/button-copy'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Switch } from '@auxx/ui/components/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs' // Import Tabs components
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError, toastError as toastErrorUtil, toastSuccess } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { AlertCircle, ArrowLeft, Eye, InboxIcon, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import SettingsPage from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface ChatWidgetSettingsPageProps {
  integrationId: string
}

// Form schema remains the same (excluding inboxId)
const updateFormSchema = z.object({
  name: z.string().min(1, 'Widget name is required').optional(),
  title: chatWidgetInputSchema.shape.title.optional(),
  subtitle: chatWidgetInputSchema.shape.subtitle.optional(),
  primaryColor: chatWidgetInputSchema.shape.primaryColor.optional(),
  logoUrl: chatWidgetInputSchema.shape.logoUrl.optional().or(z.literal('')),
  position: chatWidgetInputSchema.shape.position.optional(),
  welcomeMessage: chatWidgetInputSchema.shape.welcomeMessage.optional(),
  autoOpen: chatWidgetInputSchema.shape.autoOpen.optional(),
  mobileFullScreen: chatWidgetInputSchema.shape.mobileFullScreen.optional(),
  collectUserInfo: chatWidgetInputSchema.shape.collectUserInfo.optional(),
  offlineMessage: chatWidgetInputSchema.shape.offlineMessage.optional(),
  allowedDomains: chatWidgetInputSchema.shape.allowedDomains
    .optional()
    .transform((val) => val?.filter((d) => d.trim() !== '').map((d) => d.trim()) ?? []),
  useAi: chatWidgetInputSchema.shape.useAi.optional(),
  aiModel: chatWidgetInputSchema.shape.aiModel.optional(),
  aiInstructions: chatWidgetInputSchema.shape.aiInstructions.optional(),
})

type ChatWidgetUpdateFormValues = z.infer<typeof updateFormSchema>

const NO_INBOX_VALUE = '__NONE__'

export default function ChatWidgetSettingsPage({ integrationId }: ChatWidgetSettingsPageProps) {
  // --- Hooks ---
  const router = useRouter()
  const utils = api.useUtils()
  const toggleIntegration = api.channel.toggle.useMutation()
  const disconnectIntegration = api.channel.disconnect.useMutation()
  const [confirm, ConfirmDialog] = useConfirm()

  // --- State ---
  const [activeTab, setActiveTab] = useState('general')
  const [currentDomain, setCurrentDomain] = useState('')

  // --- Data Fetching ---
  const {
    data: integrationData,
    isLoading: isLoadingData,
    error: dataError,
  } = api.channel.getChatWidgetIntegration.useQuery(
    { integrationId },
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
  )
  const { data: installCodeData, isLoading: isLoadingCode } =
    api.channel.getInstallationCode.useQuery({ integrationId }, { enabled: !!integrationData })
  const { data: inboxesData, isLoading: isLoadingInboxes } = api.inbox.getAll.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  })

  // --- Mutations ---
  const updateChatWidget = api.channel.updateChatWidgetIntegration.useMutation()

  // --- Form Setup ---
  const form = useForm<ChatWidgetUpdateFormValues>({
    resolver: standardSchemaResolver(updateFormSchema),
    defaultValues: {
      name: '',
      title: '',
      subtitle: '',
      primaryColor: '#4F46E5', // A sensible default color
      logoUrl: '',
      position: 'BOTTOM_RIGHT', // Default position
      welcomeMessage: '',
      autoOpen: false,
      mobileFullScreen: true, // Or false, depending on your desired default
      collectUserInfo: false,
      offlineMessage: '',
      allowedDomains: [],
      useAi: false,
      aiModel: '',
      aiInstructions: '',
    },
  })

  const watchedFormValues = form.watch()

  // --- Effects ---
  useEffect(() => {
    if (integrationData?.chatWidget) {
      const widget = integrationData.chatWidget
      form.reset({
        name: integrationData.name ?? widget.name ?? '',
        title: widget.title ?? '',
        subtitle: widget.subtitle ?? '',
        primaryColor: widget.primaryColor ?? '#4F46E5',
        logoUrl: widget.logoUrl ?? '',
        position: widget.position ?? 'BOTTOM_RIGHT',
        welcomeMessage: widget.welcomeMessage ?? '',
        autoOpen: widget.autoOpen ?? false,
        mobileFullScreen: widget.mobileFullScreen ?? true,
        collectUserInfo: widget.collectUserInfo ?? false,
        offlineMessage: widget.offlineMessage ?? '',
        allowedDomains: widget.allowedDomains ?? [],
        useAi: widget.useAi ?? false,
        aiModel: widget.aiModel ?? '',
        aiInstructions: widget.aiInstructions ?? '',
      })
    }
  }, [integrationData, form])

  // --- Handlers ---
  const onSubmit = (values: ChatWidgetUpdateFormValues) => {
    console.log('Updating Chat Widget Settings (All Tabs):', values)
    updateChatWidget.mutate(
      { integrationId, ...values },
      {
        onSuccess: () => {
          toastSuccess({
            title: 'Settings Saved',
            description: 'Chat widget configuration updated.',
          })
          utils.channel.getChatWidgetIntegration.invalidate({ integrationId })
          utils.channel.list.invalidate()
          form.reset({}, { keepValues: true })
        },
        onError: (error) => {
          toastError({ title: 'Save Failed', description: error.message })
        },
      }
    )
  }

  const handleInboxChange = (newInboxIdValue: string) => {
    const finalInboxId = newInboxIdValue === NO_INBOX_VALUE ? null : newInboxIdValue
    updateChatWidget.mutate(
      { integrationId, inboxId: finalInboxId },
      {
        onSuccess: () => {
          toastSuccess({ description: 'Inbox Routing Updated' })
          utils.channel.getChatWidgetIntegration.invalidate({ integrationId })
          utils.channel.list.invalidate()
        },
        onError: (error) => {
          toastError({ title: 'Update Failed', description: error.message })
        },
      }
    )
  }

  const handleToggleStatus = (enabled: boolean) => {
    toggleIntegration.mutate(
      { integrationId, enabled },
      {
        onSuccess: () => {
          toastSuccess({ description: `Widget ${enabled ? 'Enabled' : 'Disabled'}` })
          utils.channel.getChatWidgetIntegration.invalidate({ integrationId })
          utils.channel.list.invalidate()
        },
        onError: (error) => {
          toastError({ title: 'Status Update Failed', description: error.message })
        },
      }
    )
  }

  // Handle removing an integration with confirmation
  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Remove integration?',
      description:
        'This will remove this integration from the inbox. Any emails from this integration will no longer be routed to this inbox.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      disconnectIntegration.mutate(
        { integrationId },
        {
          onSuccess: () => {
            toastSuccess({ description: 'Integration Deleted' })
            utils.channel.list.invalidate()
            utils.user.me.invalidate()
            router.push('/app/settings/channels')
          },
          onError: (error) => {
            toastError({ title: 'Deletion Failed', description: error.message })
          },
        }
      )
    }
  }

  const handleAddDomain = () => {
    const trimmedDomain = currentDomain.trim()
    if (trimmedDomain) {
      const currentDomains = form.getValues('allowedDomains') ?? []
      if (!currentDomains.includes(trimmedDomain)) {
        form.setValue('allowedDomains', [...currentDomains, trimmedDomain], { shouldDirty: true })
        setCurrentDomain('')
      } else {
        toastError({ description: 'Domain already added.' })
      }
    }
  }
  const handleRemoveDomain = (domainToRemove: string) => {
    form.setValue(
      'allowedDomains',
      form.getValues('allowedDomains')?.filter((d) => d !== domainToRemove) ?? [],
      { shouldDirty: true }
    )
  }
  const handleBack = () => router.push('/app/settings/channels')

  // --- Loading/Error States ---
  if (isLoadingData || isLoadingInboxes) {
    return (
      <div className='container space-y-4 py-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-10 w-full max-w-sm' />
        <Skeleton className='h-96 w-full' />
      </div>
    )
  }
  if (dataError || !integrationData || !integrationData.chatWidget) {
    return (
      <div className='container py-6'>
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{dataError?.message || 'Failed...'}</AlertDescription>
        </Alert>
      </div>
    )
  }

  const widget = integrationData.chatWidget // Alias

  // --- NEW: Preview Handler ---
  const handlePreview = () => {
    // 1. Get current form values (unsaved state)
    const currentConfig = form.getValues()

    const organizationId = integrationData?.organizationId
    if (!organizationId) {
      toastError({ description: 'Cannot generate preview link: Organization ID missing.' })
      return
    }

    // 2. Construct URL search parameters from the config
    const params = new URLSearchParams()
    params.set('widgetId', integrationId) // The bundle expects widgetId
    console.log(organizationId)
    params.set('orgId', organizationId) // Pass organizationId

    // Add only necessary fields for previewing appearance/behavior
    params.set('title', currentConfig.title || 'Chat Preview')
    if (currentConfig.subtitle) params.set('subtitle', currentConfig.subtitle)
    params.set('primaryColor', currentConfig.primaryColor || '#4F46E5')
    if (currentConfig.logoUrl) params.set('logoUrl', currentConfig.logoUrl)
    params.set('position', currentConfig.position || 'BOTTOM_RIGHT')
    if (currentConfig.welcomeMessage) params.set('welcomeMessage', currentConfig.welcomeMessage)
    params.set('autoOpen', currentConfig.autoOpen ? 'true' : 'false') // Convert boolean
    params.set('mobileFullScreen', currentConfig.mobileFullScreen ? 'true' : 'false')
    params.set('collectUserInfo', currentConfig.collectUserInfo ? 'true' : 'false')
    // Note: We pass the *real* integrationId so the preview can initialize a *real* session
    // Be mindful of potential test data flooding if users preview excessively.
    // Consider adding a flag if you want the preview to use a mock backend later.

    // 3. Construct the preview URL
    // Use a path like '/preview/widget/[integrationId]' - adjust if needed
    const previewUrl = `/preview/widget/${integrationId}?${params.toString()}`

    // 4. Open in a new window
    window.open(
      previewUrl,
      `widget-preview-${integrationId}`,
      'width=800,height=700,resizable,scrollbars'
    )
  }

  return (
    <SettingsPage
      title={`Edit Chat Widget: ${integrationData.name || widget.name}`}
      description='Modify the appearance, behavior, and settings.'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Channels', href: '/app/settings/channels' },
        { title: 'Chat Widget' },
      ]}
      button={
        <Button variant='outline' size='sm' onClick={handleBack}>
          <ArrowLeft className='mr-2 h-4 w-4' />
          Back
        </Button>
      }>
      <ConfirmDialog />
      <div className=' space-y-6 p-6'>
        {/* Header */}
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <div className='flex shrink-0 items-center space-x-2'>
            <span className='text-sm font-medium'>Status:</span>
            <Switch
              checked={integrationData.enabled}
              onCheckedChange={handleToggleStatus}
              disabled={toggleIntegration.isPending}
              aria-label='Toggle Integration Status'
            />
            <span
              className={`text-sm font-medium ${integrationData.enabled ? 'text-green-600' : 'text-muted-foreground'}`}>
              {toggleIntegration.isPending ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : integrationData.enabled ? (
                'Enabled'
              ) : (
                'Disabled'
              )}
            </span>
          </div>
          <div className='flex items-center space-x-2'>
            <Button variant='outline' size='sm' onClick={handlePreview} disabled={!integrationData}>
              <Eye className='mr-2 h-4 w-4' />
              Preview Widget
            </Button>
          </div>
        </div>

        {/* Inbox Routing (Separate Card) */}
        <div>
          <div className='flex items-center justify-between'>
            <CardHeader className='pl-0'>
              <CardTitle className='flex items-center gap-2'>
                <InboxIcon size={20} /> Inbox Routing
              </CardTitle>
              <CardDescription>
                Select the inbox where new chat conversations will appear.
              </CardDescription>
            </CardHeader>
            <div>
              <Select
                value={integrationData.inboxId ?? NO_INBOX_VALUE}
                onValueChange={handleInboxChange}
                disabled={isLoadingInboxes || updateChatWidget.isPending}>
                <SelectTrigger className='w-full md:w-[350px]'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INBOX_VALUE}>-- Not Connected --</SelectItem>
                  {inboxesData?.map((inbox) => (
                    <SelectItem key={inbox.id} value={inbox.id}>
                      {inbox.name}
                    </SelectItem>
                  ))}
                  {!inboxesData?.length && !isLoadingInboxes && (
                    <div className='p-2 text-sm text-muted-foreground'>No inboxes.</div>
                  )}
                </SelectContent>
              </Select>
              {updateChatWidget.isPending && (
                <p className='mt-2 flex items-center gap-1 text-sm text-muted-foreground'>
                  <Loader2 className='h-4 w-4 animate-spin' /> Updating...
                </p>
              )}
            </div>
          </div>
        </div>

        {/* --- Settings Tabs --- */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className='grid w-full grid-cols-3 md:grid-cols-6'>
                <TabsTrigger value='general'>General</TabsTrigger>
                <TabsTrigger value='appearance'>Appearance</TabsTrigger>
                <TabsTrigger value='behavior'>Behavior</TabsTrigger>
                <TabsTrigger value='domains'>Domains</TabsTrigger>
                <TabsTrigger value='ai'>AI</TabsTrigger>
                <TabsTrigger value='installation'>Installation</TabsTrigger>
              </TabsList>

              {/* General Tab */}
              <TabsContent value='general' className='mt-6'>
                <Card>
                  <CardHeader>
                    <CardTitle>General Settings</CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <FormField
                      control={form.control}
                      name='name'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Widget Name (Internal)</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormDescription>
                            An internal name to identify this widget integration.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Appearance Tab */}
              <TabsContent value='appearance' className='mt-6'>
                <Card>
                  <CardHeader>
                    <CardTitle>Appearance Customization</CardTitle>
                  </CardHeader>
                  <CardContent className='grid grid-cols-1 gap-4 space-y-4 md:grid-cols-2'>
                    <FormField
                      control={form.control}
                      name='title'
                      render={({ field }) => (
                        <FormItem>
                          {' '}
                          <FormLabel>Widget Title</FormLabel>{' '}
                          <FormControl>
                            <Input {...field} />
                          </FormControl>{' '}
                          <FormMessage />{' '}
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name='subtitle'
                      render={({ field }) => (
                        <FormItem>
                          {' '}
                          <FormLabel>Subtitle</FormLabel>{' '}
                          <FormControl>
                            <Input {...field} />
                          </FormControl>{' '}
                          <FormMessage />{' '}
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name='primaryColor'
                      render={({ field }) => (
                        <FormItem>
                          {' '}
                          <FormLabel>Primary Color</FormLabel>{' '}
                          <FormControl>
                            <Input type='color' {...field} />
                          </FormControl>
                          <FormMessage />{' '}
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name='logoUrl'
                      render={({ field }) => (
                        <FormItem>
                          {' '}
                          <FormLabel>Logo URL (Optional)</FormLabel>{' '}
                          <FormControl>
                            <Input type='url' {...field} />
                          </FormControl>{' '}
                          <FormMessage />{' '}
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name='position'
                      render={({ field }) => (
                        <FormItem>
                          {' '}
                          <FormLabel>Position</FormLabel>{' '}
                          <Select onValueChange={field.onChange} value={field.value}>
                            {' '}
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>{' '}
                            <SelectContent>
                              {' '}
                              <SelectItem value='BOTTOM_RIGHT'>Bottom Right</SelectItem>{' '}
                              <SelectItem value='BOTTOM_LEFT'>Bottom Left</SelectItem>{' '}
                              <SelectItem value='TOP_RIGHT'>Top Right</SelectItem>{' '}
                              <SelectItem value='TOP_LEFT'>Top Left</SelectItem>{' '}
                            </SelectContent>{' '}
                          </Select>{' '}
                          <FormMessage />{' '}
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Behavior Tab */}
              <TabsContent value='behavior' className='mt-6'>
                <Card>
                  <CardHeader>
                    <CardTitle>Widget Behavior</CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-6'>
                    <FormField
                      control={form.control}
                      name='welcomeMessage'
                      render={({ field }) => (
                        <FormItem>
                          {' '}
                          <FormLabel>Welcome Message</FormLabel>{' '}
                          <FormControl>
                            <Textarea {...field} />
                          </FormControl>{' '}
                          <FormDescription>Sent automatically at chat start.</FormDescription>
                          <FormMessage />{' '}
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name='offlineMessage'
                      render={({ field }) => (
                        <FormItem>
                          {' '}
                          <FormLabel>Offline Message</FormLabel>{' '}
                          <FormControl>
                            <Textarea {...field} />
                          </FormControl>
                          <FormDescription>
                            Shown when initiated outside operating hours.
                          </FormDescription>{' '}
                          <FormMessage />{' '}
                        </FormItem>
                      )}
                    />
                    <div className='grid grid-cols-1 gap-4 pt-4 md:grid-cols-3'>
                      <FormField
                        control={form.control}
                        name='autoOpen'
                        render={({ field }) => (
                          <FormItem className='flex items-center justify-between rounded-lg border p-4'>
                            {' '}
                            <FormLabel>Auto Open</FormLabel>{' '}
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>{' '}
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='mobileFullScreen'
                        render={({ field }) => (
                          <FormItem className='flex items-center justify-between rounded-lg border p-4'>
                            {' '}
                            <FormLabel>Mobile Full Screen</FormLabel>{' '}
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>{' '}
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='collectUserInfo'
                        render={({ field }) => (
                          <FormItem className='flex items-center justify-between rounded-lg border p-4'>
                            {' '}
                            <FormLabel>Collect User Info</FormLabel>{' '}
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>{' '}
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Domains Tab */}
              <TabsContent value='domains' className='mt-6'>
                <Card>
                  <CardHeader>
                    <CardTitle>Allowed Domains</CardTitle>
                    <CardDescription>
                      Restrict where the widget can be embedded. Leave empty to allow anywhere.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className='flex items-center space-x-2'>
                      <Input
                        placeholder='example.com'
                        value={currentDomain}
                        onChange={(e) => setCurrentDomain(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleAddDomain()
                          }
                        }}
                      />
                      <Button type='button' variant='outline' onClick={handleAddDomain}>
                        Add
                      </Button>
                    </div>
                    <div className='mt-3 max-h-40 space-y-1 overflow-y-auto rounded border p-2'>
                      {form.watch('allowedDomains')?.map((domain) => (
                        <div
                          key={domain}
                          className='flex items-center justify-between rounded bg-background p-1 px-2 text-sm'>
                          <span>{domain}</span>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            onClick={() => handleRemoveDomain(domain)}
                            className='h-6 px-1 text-muted-foreground hover:text-destructive'>
                            Remove
                          </Button>
                        </div>
                      ))}
                      {form.watch('allowedDomains')?.length === 0 && (
                        <p className='py-2 text-center text-sm text-muted-foreground'>
                          No domain restrictions applied.
                        </p>
                      )}
                    </div>
                    <FormField
                      control={form.control}
                      name='allowedDomains'
                      render={() => <FormMessage />}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* AI Tab */}
              <TabsContent value='ai' className='mt-6'>
                <Card>
                  <CardHeader>
                    <CardTitle>AI Settings</CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <FormField
                      control={form.control}
                      name='useAi'
                      render={({ field }) => (
                        <FormItem className='flex items-center justify-between rounded-lg border p-4'>
                          {' '}
                          <div className='space-y-0.5'>
                            <FormLabel>Use AI Assistance</FormLabel>
                            <FormDescription>
                              Enable AI features (requires configuration).
                            </FormDescription>
                          </div>{' '}
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>{' '}
                        </FormItem>
                      )}
                    />
                    {form.watch('useAi') && (
                      <div className='ml-2 space-y-4 border-l pl-4 pt-4'>
                        <FormField
                          control={form.control}
                          name='aiModel'
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>AI Model</FormLabel>
                              <FormControl>
                                <Input placeholder='e.g., gpt-4o' {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name='aiInstructions'
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>AI Instructions</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder='Instructions for the AI assistant...'
                                  {...field}
                                  rows={4}
                                />
                              </FormControl>
                              <FormDescription>
                                Provide context or specific instructions.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Installation Tab */}
              <TabsContent value='installation' className='mt-6'>
                <Card>
                  <CardHeader>
                    <CardTitle>Installation</CardTitle>
                    <CardDescription>
                      Copy and paste this snippet into your website's HTML.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isLoadingCode && <Skeleton className='h-20 w-full' />}
                    {installCodeData?.script && (
                      <div className='relative rounded bg-muted p-4 font-mono text-sm'>
                        <pre className='overflow-x-auto'>
                          <code>{installCodeData.script}</code>
                        </pre>
                        <CopyButton
                          text={installCodeData.script}
                          className='absolute right-2 top-2'
                        />
                      </div>
                    )}
                    {!isLoadingCode && !installCodeData?.script && (
                      <p className='text-destructive'>Could not load installation code.</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Save Button (Outside Tabs, inside Form) */}
            <div className='sticky bottom-0 flex justify-end border-t bg-background py-3 pt-4'>
              <Button
                type='submit'
                disabled={updateChatWidget.isPending || !form.formState.isDirty}>
                {updateChatWidget.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                Save Settings
              </Button>
            </div>
          </form>
        </Form>

        <Separator className='my-8' />

        {/* Danger Zone (Separate Card) */}
        <Card className='border-destructive'>
          <CardHeader>
            <CardTitle className='text-destructive'>Danger Zone</CardTitle>
            <CardDescription>Deleting this integration cannot be undone.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              variant='destructive'
              onClick={handleDelete}
              loading={disconnectIntegration.isPending}
              loadingText='Deleting...'>
              Delete Integration
            </Button>
          </CardFooter>
        </Card>
      </div>
    </SettingsPage>
  )
}
