// apps/web/src/components/chat-widget/ui/settings/sections/appearance-section.tsx
'use client'
import { FieldType } from '@auxx/database/enums'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import { Button } from '@auxx/ui/components/button'
import { Form, FormControl, FormDescription, FormField, FormItem } from '@auxx/ui/components/form'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import type { JSONContent } from '@tiptap/react'
import { LayoutGrid, MessageSquare, Moon, Palette, Smartphone, Sun, SunMoon } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { SettingsSection } from '~/components/global/settings-page'
import { ColorField } from '~/components/ui/color-field'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'
import { GreetingEditor } from '../greeting-editor'
import { SuggestedRepliesEditor } from '../suggested-replies-editor'
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

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System (OS preference)' },
]

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const appearanceSchema = z.object({
  defaultTheme: z.enum(['light', 'dark', 'system']),
  primaryColor: z.string().regex(HEX_RE, 'Use a valid hex color (#fff or #ffffff)'),
  headerColor: z
    .string()
    .refine((v) => !v || HEX_RE.test(v), 'Use a valid hex color (#fff or #ffffff)')
    .nullish(),
  primaryColorDark: z
    .string()
    .refine((v) => !v || HEX_RE.test(v), 'Use a valid hex color (#fff or #ffffff)')
    .nullish(),
  headerColorDark: z
    .string()
    .refine((v) => !v || HEX_RE.test(v), 'Use a valid hex color (#fff or #ffffff)')
    .nullish(),
  position: z.enum(['BOTTOM_RIGHT', 'BOTTOM_LEFT', 'TOP_RIGHT', 'TOP_LEFT']),
  logoLight: z.string().nullish(),
  logoDark: z.string().nullish(),
  mobileFullScreen: z.boolean(),
  homeGreetingTemplate: z.unknown().optional(),
  welcomeMessageTemplate: z.unknown().optional(),
  suggestedReplies: z.array(z.string().max(80)).max(5).optional(),
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
      defaultTheme:
        ((widget.chatWidget as { defaultTheme?: string })
          ?.defaultTheme as AppearanceForm['defaultTheme']) ?? 'light',
      primaryColor: widget.chatWidget?.primaryColor ?? '#4F46E5',
      headerColor: widget.chatWidget?.headerColor ?? '',
      primaryColorDark:
        (widget.chatWidget as { primaryColorDark?: string | null })?.primaryColorDark ?? '',
      headerColorDark:
        (widget.chatWidget as { headerColorDark?: string | null })?.headerColorDark ?? '',
      position: (widget.chatWidget?.position as AppearanceForm['position']) ?? 'BOTTOM_RIGHT',
      logoLight: widget.chatWidget?.logoLight ?? '',
      logoDark: widget.chatWidget?.logoDark ?? '',
      mobileFullScreen: widget.chatWidget?.mobileFullScreen ?? true,
      homeGreetingTemplate: (widget.chatWidget?.homeGreetingTemplate as JSONContent | null) ?? null,
      welcomeMessageTemplate:
        ((widget.chatWidget as { welcomeMessageTemplate?: JSONContent | null })
          ?.welcomeMessageTemplate as JSONContent | null) ?? null,
      suggestedReplies:
        (widget.chatWidget as { suggestedReplies?: string[] | null })?.suggestedReplies ?? [],
    },
  })

  const chatWidgetId = widget.chatWidget?.id ?? ''

  const watchedTheme = form.watch('defaultTheme')
  const showDarkColors = watchedTheme !== 'light'

  const onSubmit = (values: AppearanceForm) => {
    update.mutate({
      integrationId: channelId,
      defaultTheme: values.defaultTheme,
      primaryColor: values.primaryColor,
      headerColor: values.headerColor || null,
      primaryColorDark: values.primaryColorDark || null,
      headerColorDark: values.headerColorDark || null,
      position: values.position,
      logoLight: values.logoLight ?? null,
      logoDark: values.logoDark ?? null,
      mobileFullScreen: values.mobileFullScreen,
      homeGreetingTemplate: values.homeGreetingTemplate ?? null,
      welcomeMessageTemplate: values.welcomeMessageTemplate ?? null,
      suggestedReplies: (values.suggestedReplies ?? [])
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 5),
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className='p-3 sm:p-6 space-y-8'>
          <div>
            <SettingsSection
              className='mb-6'
              icon={Palette}
              title='Branding'
              description='The color and logo shown on the widget header.'>
              <VarEditorField
                orientation='responsive'
                className='p-0 **:data-[slot=field-row-label]:w-[12rem]! @sm:**:data-[slot=field-row-label]:w-[12rem]!'>
                <FormField
                  control={form.control}
                  name='defaultTheme'
                  render={({ field, fieldState }) => (
                    <VarEditorFieldRow
                      title='Theme'
                      description='Default color scheme. The embed script can override this per-page via data-theme.'
                      type={BaseType.ENUM}
                      icon={<SunMoon className='size-3.5' />}
                      showIcon
                      validationError={fieldState.error?.message}>
                      <FieldInputAdapter
                        fieldType={FieldType.SINGLE_SELECT}
                        fieldOptions={{ options: THEME_OPTIONS }}
                        value={field.value}
                        onChange={(v) => {
                          const next = Array.isArray(v) ? v[0] : v
                          if (typeof next === 'string') {
                            field.onChange(next as AppearanceForm['defaultTheme'])
                          }
                        }}
                        placeholder='Choose theme'
                        triggerProps={{ className: 'w-full ps-0 pe-1' }}
                      />
                    </VarEditorFieldRow>
                  )}
                />

                <FormField
                  control={form.control}
                  name='primaryColor'
                  render={({ field, fieldState }) => (
                    <VarEditorFieldRow
                      title='Primary Color'
                      description='Used for the launcher button, send buttons, and accent UI.'
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

                {showDarkColors ? (
                  <FormField
                    control={form.control}
                    name='primaryColorDark'
                    render={({ field, fieldState }) => (
                      <VarEditorFieldRow
                        title='Primary Color (dark)'
                        description='Primary color in dark mode. Optional — falls back to the light primary color.'
                        type={BaseType.STRING}
                        icon={<Moon className='size-3.5' />}
                        showIcon
                        validationError={fieldState.error?.message}>
                        <ColorField
                          value={field.value || ''}
                          onChange={field.onChange}
                          placeholder='Same as light'
                        />
                      </VarEditorFieldRow>
                    )}
                  />
                ) : null}

                <FormField
                  control={form.control}
                  name='headerColor'
                  render={({ field, fieldState }) => (
                    <VarEditorFieldRow
                      title='Header Color'
                      description='Background of the Home greeting band. Leave empty to derive from the brand color. Text color is auto-picked for contrast.'
                      type={BaseType.STRING}
                      icon={<Palette className='size-3.5' />}
                      showIcon
                      validationError={fieldState.error?.message}>
                      <ColorField
                        value={field.value || ''}
                        onChange={field.onChange}
                        placeholder='Auto (brand)'
                        clearable
                      />
                    </VarEditorFieldRow>
                  )}
                />

                {showDarkColors ? (
                  <FormField
                    control={form.control}
                    name='headerColorDark'
                    render={({ field, fieldState }) => (
                      <VarEditorFieldRow
                        title='Header Color (dark)'
                        description='Home greeting band color in dark mode. Optional — falls back to the light header color.'
                        type={BaseType.STRING}
                        icon={<Moon className='size-3.5' />}
                        showIcon
                        validationError={fieldState.error?.message}>
                        <ColorField
                          value={field.value || ''}
                          onChange={field.onChange}
                          placeholder='Same as light'
                        />
                      </VarEditorFieldRow>
                    )}
                  />
                ) : null}

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
                      description='Used when the resolved theme is dark. Falls back to the light logo if unset.'
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
            </SettingsSection>

            <SettingsSection
              className='mt-6 mb-4'
              icon={LayoutGrid}
              title='Layout'
              description='Where and how the widget appears on the page.'>
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
                      <div className='ps-3'>
                        <FieldInputAdapter
                          fieldType={FieldType.CHECKBOX}
                          fieldOptions={{ variant: 'switch' }}
                          value={field.value}
                          onChange={(v) => field.onChange(Boolean(v))}
                        />
                      </div>
                    </VarEditorFieldRow>
                  )}
                />
              </VarEditorField>
            </SettingsSection>
          </div>

          <div>
            <SettingsSection
              className='mb-6'
              icon={MessageSquare}
              title='Greeting'
              description="Personalised message shown on the widget's Home screen.">
              <FormField
                control={form.control}
                name='homeGreetingTemplate'
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <GreetingEditor
                        value={(field.value as JSONContent | null) ?? null}
                        onChange={field.onChange}
                        placeholder='Hi {visitor:name} 👋'
                      />
                    </FormControl>
                    <FormDescription>
                      Type <code className='rounded bg-muted px-1'>{'{'}</code> to insert a visitor
                      field. Click the badge to set a fallback for when the value isn't available.
                    </FormDescription>
                  </FormItem>
                )}
              />
            </SettingsSection>

            <SettingsSection
              className='mt-6 mb-4'
              icon={MessageSquare}
              title='Welcome message'
              description='Synthetic first bubble shown inside a new conversation, before the visitor types anything. Sender is the configured AI agent (or your org name when no agent is bound).'>
              <FormField
                control={form.control}
                name='welcomeMessageTemplate'
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <GreetingEditor
                        value={(field.value as JSONContent | null) ?? null}
                        onChange={field.onChange}
                        placeholder='Hi {visitor:name}, how can I help today?'
                      />
                    </FormControl>
                    <FormDescription>
                      Type <code className='rounded bg-muted px-1'>{'{'}</code> to insert a visitor
                      field. The bubble disappears the moment the visitor sends their first message.
                    </FormDescription>
                  </FormItem>
                )}
              />
            </SettingsSection>

            <div className='mt-6 mb-2 text-sm font-medium text-foreground'>Suggested replies</div>
            <p className='mb-3 text-sm text-muted-foreground'>
              Shown above the composer until the visitor sends their first message. Tapping a
              suggestion sends it as the visitor's message.
            </p>
            <FormField
              control={form.control}
              name='suggestedReplies'
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <SuggestedRepliesEditor
                      value={(field.value as string[] | undefined) ?? []}
                      onChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
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
