// apps/web/src/components/chat-widget/ui/settings/sections/appearance-section.tsx
'use client'
import { FieldType } from '@auxx/database/enums'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import { Button } from '@auxx/ui/components/button'
import { Form, FormField } from '@auxx/ui/components/form'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { LayoutGrid, Moon, Palette, Smartphone, Sun } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { ColorField } from '~/components/ui/color-field'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'
import { LogoUploadCell } from './logo-upload-cell'

interface AppearanceSectionProps {
  widget: ChatWidgetWithIntegration
  channelId: string
}

const POSITION_OPTIONS = [
  { value: 'BOTTOM_RIGHT', label: 'Bottom Right' },
  { value: 'BOTTOM_LEFT', label: 'Bottom Left' },
  { value: 'TOP_RIGHT', label: 'Top Right' },
  { value: 'TOP_LEFT', label: 'Top Left' },
]

const appearanceSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a valid hex color (#fff or #ffffff)'),
  position: z.enum(['BOTTOM_RIGHT', 'BOTTOM_LEFT', 'TOP_RIGHT', 'TOP_LEFT']),
  logoLight: z.string().nullish(),
  logoDark: z.string().nullish(),
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
      logoLight: widget.chatWidget?.logoLight ?? '',
      logoDark: widget.chatWidget?.logoDark ?? '',
      mobileFullScreen: widget.chatWidget?.mobileFullScreen ?? true,
    },
  })

  const chatWidgetId = widget.chatWidget?.id ?? ''

  const onSubmit = (values: AppearanceForm) => {
    update.mutate({
      integrationId: channelId,
      primaryColor: values.primaryColor,
      position: values.position,
      logoLight: values.logoLight ?? null,
      logoDark: values.logoDark ?? null,
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

            <VarEditorField orientation='responsive' className='p-0'>
              <FormField
                control={form.control}
                name='primaryColor'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Primary Color'
                    description='Used for buttons, links, and the widget header.'
                    type={BaseType.STRING}
                    icon={<Palette className='size-3.5' />}
                    showIcon
                    isRequired
                    validationError={fieldState.error?.message}>
                    <ColorField
                      value={field.value || ''}
                      onChange={field.onChange}
                      placeholder='Pick a color'
                    />
                  </VarEditorFieldRow>
                )}
              />

              <FormField
                control={form.control}
                name='logoLight'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Light mode logo'
                    description='Shown on the dark primary-colored header band.'
                    icon={<Sun className='size-3.5' />}
                    showIcon
                    validationError={fieldState.error?.message}>
                    <LogoUploadCell
                      variant='light'
                      value={field.value ?? ''}
                      onChange={(v) => field.onChange(v)}
                      chatWidgetId={chatWidgetId}
                    />
                  </VarEditorFieldRow>
                )}
              />

              <FormField
                control={form.control}
                name='logoDark'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Dark mode logo'
                    description='Reserved for light-surface headers.'
                    icon={<Moon className='size-3.5' />}
                    showIcon
                    validationError={fieldState.error?.message}>
                    <LogoUploadCell
                      variant='dark'
                      value={field.value ?? ''}
                      onChange={(v) => field.onChange(v)}
                      chatWidgetId={chatWidgetId}
                    />
                  </VarEditorFieldRow>
                )}
              />
            </VarEditorField>
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

            <VarEditorField orientation='responsive' className='p-0'>
              <FormField
                control={form.control}
                name='position'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Position'
                    description='Corner of the page where the widget anchors.'
                    type={BaseType.ENUM}
                    icon={<LayoutGrid className='size-3.5' />}
                    showIcon
                    validationError={fieldState.error?.message}>
                    <FieldInputAdapter
                      fieldType={FieldType.SINGLE_SELECT}
                      fieldOptions={{ options: POSITION_OPTIONS }}
                      value={field.value}
                      onChange={(v) => {
                        const next = Array.isArray(v) ? v[0] : v
                        if (typeof next === 'string') {
                          field.onChange(next as AppearanceForm['position'])
                        }
                      }}
                      placeholder='Choose position'
                      triggerProps={{ className: 'w-full' }}
                    />
                  </VarEditorFieldRow>
                )}
              />

              <FormField
                control={form.control}
                name='mobileFullScreen'
                render={({ field, fieldState }) => (
                  <VarEditorFieldRow
                    title='Mobile Full Screen'
                    description='Expand the widget to fill the screen on small devices.'
                    type={BaseType.BOOLEAN}
                    icon={<Smartphone className='size-3.5' />}
                    showIcon
                    validationError={fieldState.error?.message}>
                    <FieldInputAdapter
                      fieldType={FieldType.CHECKBOX}
                      fieldOptions={{ variant: 'switch' }}
                      value={field.value}
                      onChange={(v) => field.onChange(Boolean(v))}
                    />
                  </VarEditorFieldRow>
                )}
              />
            </VarEditorField>
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
