// apps/web/src/components/chat-widget/ui/settings/sections/appearance-section.tsx
'use client'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import { Button } from '@auxx/ui/components/button'
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
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { LayoutGrid, Palette, Smartphone } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '~/trpc/react'

interface AppearanceSectionProps {
  widget: ChatWidgetWithIntegration
  channelId: string
}

const appearanceSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a valid hex color (#fff or #ffffff)'),
  position: z.enum(['BOTTOM_RIGHT', 'BOTTOM_LEFT', 'TOP_RIGHT', 'TOP_LEFT']),
  logoUrl: z.string().url('Must be a valid URL').or(z.literal('')).optional(),
  mobileFullScreen: z.boolean(),
})

type AppearanceForm = z.infer<typeof appearanceSchema>

export function AppearanceSection({ widget, channelId }: AppearanceSectionProps) {
  const utils = api.useUtils()

  const update = api.channel.updateChatWidgetIntegration.useMutation({
    onSuccess: () => {
      utils.channel.getChatWidgetIntegration.invalidate({ integrationId: channelId })
    },
    onError: (e) => toastError({ title: 'Failed to save', description: e.message }),
  })

  const form = useForm<AppearanceForm>({
    resolver: standardSchemaResolver(appearanceSchema),
    defaultValues: {
      primaryColor: widget.chatWidget?.primaryColor ?? '#4F46E5',
      position: (widget.chatWidget?.position as AppearanceForm['position']) ?? 'BOTTOM_RIGHT',
      logoUrl: widget.chatWidget?.logoUrl ?? '',
      mobileFullScreen: widget.chatWidget?.mobileFullScreen ?? true,
    },
  })

  const onSubmit = (values: AppearanceForm) => {
    update.mutate({
      integrationId: channelId,
      primaryColor: values.primaryColor,
      position: values.position,
      logoUrl: values.logoUrl || undefined,
      mobileFullScreen: values.mobileFullScreen,
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className='flex flex-col lg:flex-row'>
          <div className='flex-1 p-6 lg:pr-6'>
            <div className='space-y-1 mb-6'>
              <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                <Palette className='size-4' /> Branding
              </div>
              <p className='text-sm text-muted-foreground'>
                The color and logo shown on the widget header.
              </p>
            </div>

            <div className='space-y-4'>
              <FormField
                control={form.control}
                name='primaryColor'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary Color</FormLabel>
                    <FormControl>
                      <div className='flex items-center gap-2'>
                        <Input type='color' className='w-16 p-1' {...field} />
                        <Input
                          type='text'
                          value={field.value}
                          onChange={field.onChange}
                          placeholder='#4F46E5'
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='logoUrl'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Logo URL (Optional)</FormLabel>
                    <FormControl>
                      <Input type='url' placeholder='https://…/logo.png' {...field} />
                    </FormControl>
                    <FormDescription>Square image works best (1:1).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className='flex-1 border-t lg:border-t-0 lg:border-l p-6 lg:pl-6'>
            <div className='space-y-1 mb-6'>
              <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
                <LayoutGrid className='size-4' /> Layout
              </div>
              <p className='text-sm text-muted-foreground'>
                Where and how the widget appears on the page.
              </p>
            </div>

            <div className='space-y-4'>
              <FormField
                control={form.control}
                name='position'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Position</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value='BOTTOM_RIGHT'>Bottom Right</SelectItem>
                        <SelectItem value='BOTTOM_LEFT'>Bottom Left</SelectItem>
                        <SelectItem value='TOP_RIGHT'>Top Right</SelectItem>
                        <SelectItem value='TOP_LEFT'>Top Left</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='mobileFullScreen'
                render={({ field }) => (
                  <div className='rounded-xl border px-3 py-2.5'>
                    <div
                      className='flex cursor-pointer items-center justify-between'
                      onClick={() => field.onChange(!field.value)}>
                      <div className='space-y-0.5'>
                        <Label className='flex cursor-pointer items-center gap-1.5 text-sm font-medium'>
                          <Smartphone className='size-3.5 text-muted-foreground' />
                          Mobile Full Screen
                        </Label>
                        <p className='text-xs text-muted-foreground'>
                          Expand the widget to fill the screen on small devices.
                        </p>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch size='sm' checked={field.value} onCheckedChange={field.onChange} />
                      </div>
                    </div>
                  </div>
                )}
              />
            </div>
          </div>
        </div>

        <div className='flex justify-end gap-2 border-t px-4 py-4'>
          <Button type='button' variant='ghost' size='sm' onClick={() => form.reset()}>
            Reset
          </Button>
          <Button
            type='submit'
            size='sm'
            variant='outline'
            loading={update.isPending}
            loadingText='Saving…'>
            Save Changes
          </Button>
        </div>
      </form>
    </Form>
  )
}
