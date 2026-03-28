// src/app/(protected)/app/settings/chat/_components/chat-widget-settings.tsx
'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@auxx/ui/components/alert-dialog'
import { Button } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import { ColorPicker } from '@auxx/ui/components/color-picker'
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
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Textarea } from '@auxx/ui/components/textarea'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Globe, Plus, Save, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useWidget, type WidgetFormValues, widgetSchema } from '~/hooks/use-widget'

interface ChatWidgetSettingsProps {
  widgetId?: string
}

export function ChatWidgetSettings({ widgetId }: ChatWidgetSettingsProps) {
  const [activeTab, setActiveTab] = useState('general')
  const [newDomain, setNewDomain] = useState('')

  const { widget, isLoading, saveWidget, deleteWidget, domains, addDomain, removeDomain } =
    useWidget(widgetId)

  // Form initialization
  const form = useForm<WidgetFormValues>({
    resolver: standardSchemaResolver(widgetSchema),
    defaultValues: {
      id: widgetId,
      name: '',
      isActive: true,
      title: 'Chat Support',
      subtitle: 'We typically reply within a few minutes',
      primaryColor: '#4F46E5',
      position: 'BOTTOM_RIGHT',
      autoOpen: false,
      mobileFullScreen: true,
      collectUserInfo: false,
      allowedDomains: [],
      useAi: false,
      operatingHoursEnabled: false,
      timezone: 'UTC',
    },
  })

  // Update form when widget data is loaded
  useEffect(() => {
    if (widget) {
      form.reset({
        id: widget.id,
        name: widget.name,
        description: widget.description || '',
        isActive: widget.isActive,
        title: widget.title,
        subtitle: widget.subtitle || '',
        primaryColor: widget.primaryColor,
        logoUrl: widget.logoUrl || '',
        position: widget.position as any,
        welcomeMessage: widget.welcomeMessage || '',
        autoOpen: widget.autoOpen,
        mobileFullScreen: widget.mobileFullScreen,
        collectUserInfo: widget.collectUserInfo,
        offlineMessage: widget.offlineMessage || '',
        allowedDomains: widget.allowedDomains,
        useAi: widget.useAi,
        aiModel: widget.aiModel || '',
        aiInstructions: widget.aiInstructions || '',
        operatingHoursEnabled: false, // For this example
        timezone: 'UTC',
      })
    }
  }, [widget, form])

  // Function to handle form submission
  const onSubmit = (values: WidgetFormValues) => {
    saveWidget(values)
  }

  // Handle adding domain
  const handleAddDomain = () => {
    if (addDomain(newDomain)) {
      setNewDomain('')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
        <div className='flex items-center justify-between'>
          <h1 className='text-2xl font-bold'>
            {widgetId ? 'Edit Chat Widget' : 'Create Chat Widget'}
          </h1>

          {widgetId && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant='destructive' type='button'>
                  <Trash2 className='mr-2 h-4 w-4' />
                  Delete Widget
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the chat widget. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={deleteWidget}
                    className='bg-destructive text-destructive-foreground hover:bg-destructive/90'>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{widgetId ? 'Edit Chat Widget' : 'Create Chat Widget'}</CardTitle>
            <CardDescription>
              Configure how your chat widget will appear and behave on your website
            </CardDescription>
          </CardHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className='w-full'>
            <CardContent>
              <TabsList className='grid w-full grid-cols-5'>
                <TabsTrigger value='general'>General</TabsTrigger>
                <TabsTrigger value='appearance'>Appearance</TabsTrigger>
                <TabsTrigger value='behavior'>Behavior</TabsTrigger>
                <TabsTrigger value='domains'>Domains</TabsTrigger>
                <TabsTrigger value='ai'>AI</TabsTrigger>
              </TabsList>
            </CardContent>

            {/* General Settings */}
            <TabsContent value='general' className='p-6 pt-0'>
              <div className='space-y-6'>
                <FormField
                  control={form.control}
                  name='name'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Widget Name</FormLabel>
                      <FormControl>
                        <Input placeholder='Support Chat Widget' {...field} disabled={isLoading} />
                      </FormControl>
                      <FormDescription>
                        This name is only used internally to identify the widget
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='description'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder='Optional description of this widget'
                          {...field}
                          disabled={isLoading}
                        />
                      </FormControl>
                      <FormDescription>
                        Optional description to help you identify this widget
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='isActive'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                      <div className='space-y-0.5'>
                        <FormLabel className='text-base'>Active</FormLabel>
                        <FormDescription>
                          When active, the widget will appear on your website
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isLoading}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>

            {/* Appearance Settings */}
            <TabsContent value='appearance' className='p-6 pt-0'>
              <div className='space-y-6'>
                <div className='grid grid-cols-2 gap-4'>
                  <FormField
                    control={form.control}
                    name='title'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Widget Title</FormLabel>
                        <FormControl>
                          <Input placeholder='Chat Support' {...field} disabled={isLoading} />
                        </FormControl>
                        <FormDescription>The title displayed in the widget header</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='subtitle'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subtitle</FormLabel>
                        <FormControl>
                          <Input
                            placeholder='We typically reply within a few minutes'
                            {...field}
                            disabled={isLoading}
                          />
                        </FormControl>
                        <FormDescription>
                          Optional subtitle displayed below the title
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className='grid grid-cols-2 gap-4'>
                  <FormField
                    control={form.control}
                    name='primaryColor'
                    render={({ field }) => (
                      <FormItem className='flex flex-col space-y-2'>
                        <FormLabel>Primary Color</FormLabel>
                        <div className='flex items-center gap-2'>
                          <ColorPicker value={field.value || '#4F46E5'} onChange={field.onChange} />
                          <Input
                            value={field.value || ''}
                            onChange={(e) => field.onChange(e.target.value)}
                            className='w-24 font-mono'
                            disabled={isLoading}
                          />
                        </div>
                        <FormDescription>The main color used for the widget</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='logoUrl'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Logo URL</FormLabel>
                        <FormControl>
                          <Input
                            placeholder='https://example.com/logo.png'
                            {...field}
                            disabled={isLoading}
                          />
                        </FormControl>
                        <FormDescription>
                          Optional logo to display in the widget header
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name='position'
                  render={({ field }) => (
                    <FormItem className='space-y-1'>
                      <FormLabel>Widget Position</FormLabel>
                      <FormDescription>
                        Choose where the widget will appear on your website
                      </FormDescription>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className='grid grid-cols-2 gap-4 pt-2'
                          disabled={isLoading}>
                          <FormItem className='flex items-center space-x-3 space-y-0'>
                            <FormControl>
                              <RadioGroupItem value='BOTTOM_RIGHT' />
                            </FormControl>
                            <FormLabel className='font-normal'>Bottom Right</FormLabel>
                          </FormItem>
                          <FormItem className='flex items-center space-x-3 space-y-0'>
                            <FormControl>
                              <RadioGroupItem value='BOTTOM_LEFT' />
                            </FormControl>
                            <FormLabel className='font-normal'>Bottom Left</FormLabel>
                          </FormItem>
                          <FormItem className='flex items-center space-x-3 space-y-0'>
                            <FormControl>
                              <RadioGroupItem value='TOP_RIGHT' />
                            </FormControl>
                            <FormLabel className='font-normal'>Top Right</FormLabel>
                          </FormItem>
                          <FormItem className='flex items-center space-x-3 space-y-0'>
                            <FormControl>
                              <RadioGroupItem value='TOP_LEFT' />
                            </FormControl>
                            <FormLabel className='font-normal'>Top Left</FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>

            {/* Behavior Settings */}
            <TabsContent value='behavior' className='p-6 pt-0'>
              <div className='space-y-6'>
                <FormField
                  control={form.control}
                  name='welcomeMessage'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Welcome Message</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder='Hi there! How can we help you today?'
                          {...field}
                          disabled={isLoading}
                        />
                      </FormControl>
                      <FormDescription>
                        This message will be sent automatically when a conversation starts
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className='grid grid-cols-1 gap-6'>
                  <FormField
                    control={form.control}
                    name='autoOpen'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                        <div className='space-y-0.5'>
                          <FormLabel className='text-base'>Auto Open</FormLabel>
                          <FormDescription>
                            Automatically open the chat when the page loads
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={isLoading}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='mobileFullScreen'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                        <div className='space-y-0.5'>
                          <FormLabel className='text-base'>Full Screen on Mobile</FormLabel>
                          <FormDescription>
                            Take up the entire screen when opened on mobile devices
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={isLoading}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='collectUserInfo'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                        <div className='space-y-0.5'>
                          <FormLabel className='text-base'>Collect User Information</FormLabel>
                          <FormDescription>
                            Ask visitors for their name and email before starting a chat
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={isLoading}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name='offlineMessage'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Offline Message</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="We're currently offline. Please leave a message and we'll get back to you as soon as possible."
                          {...field}
                          disabled={isLoading}
                        />
                      </FormControl>
                      <FormDescription>
                        Message to display when no agents are available
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>

            {/* Domain Settings */}
            <TabsContent value='domains' className='p-6 pt-0'>
              <div className='space-y-6'>
                <div>
                  <h3 className='text-base font-medium'>Allowed Domains</h3>
                  <p className='mb-4 text-sm text-muted-foreground'>
                    Restrict which domains can load your chat widget. Leave empty to allow all
                    domains.
                  </p>

                  <div className='mb-4 flex items-center space-x-2'>
                    <Input
                      placeholder='example.com'
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value)}
                      className='flex-1'
                      disabled={isLoading}
                    />
                    <Button
                      type='button'
                      onClick={handleAddDomain}
                      disabled={isLoading || !newDomain}>
                      <Plus className='mr-2 h-4 w-4' />
                      Add
                    </Button>
                  </div>

                  {domains.length > 0 ? (
                    <div className='mt-2 space-y-2'>
                      {domains.map((domain) => (
                        <div
                          key={domain}
                          className='flex items-center justify-between rounded-md border px-3 py-2'>
                          <div className='flex items-center'>
                            <Globe className='mr-2 h-4 w-4 text-muted-foreground' />
                            <span>{domain}</span>
                          </div>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            onClick={() => removeDomain(domain)}
                            disabled={isLoading}>
                            <X className='h-4 w-4' />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className='rounded-md border bg-muted/50 p-4 text-center'>
                      <p className='text-sm text-muted-foreground'>
                        No domains added. The widget will be available on any website.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* AI Settings */}
            <TabsContent value='ai' className='p-6 pt-0'>
              <div className='space-y-6'>
                <FormField
                  control={form.control}
                  name='useAi'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                      <div className='space-y-0.5'>
                        <FormLabel className='text-base'>Enable AI Responses</FormLabel>
                        <FormDescription>
                          Use AI to automatically respond to common questions
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isLoading}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.watch('useAi') && (
                  <>
                    <FormField
                      control={form.control}
                      name='aiModel'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>AI Model</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            disabled={isLoading}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder='Select an AI model' />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value='gpt-4o'>OpenAI GPT-4o</SelectItem>
                              <SelectItem value='claude-sonnet-4-6'>
                                Anthropic Claude Sonnet 4.6
                              </SelectItem>
                              <SelectItem value='claude-haiku-4-5-20251001'>
                                Anthropic Claude Haiku 4.5
                              </SelectItem>
                              <SelectItem value='gemini-pro'>Google Gemini Pro</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            The AI model to use for automated responses
                          </FormDescription>
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
                              placeholder='You are a helpful customer support agent for our company. Answer questions accurately and concisely, and ask for more information if needed.'
                              {...field}
                              disabled={isLoading}
                              className='min-h-32'
                            />
                          </FormControl>
                          <FormDescription>
                            Instructions that guide how the AI should respond
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <CardFooter className='border-t px-6 py-4'>
            <Button type='submit' disabled={isLoading} className='ml-auto'>
              {isLoading ? (
                <>Saving...</>
              ) : (
                <>
                  <Save className='mr-2 h-4 w-4' />
                  Save Widget
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  )
}
