// apps/build/src/app/(portal)/[slug]/apps/[app_slug]/connections/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import { TooltipError, TooltipExplanation } from '@auxx/ui/components/tooltip'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Loader2, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { toastError } from '~/components/global/toast'
import { api } from '~/trpc/react'

/** Connection form validation schema */
const connectionFormSchema = z
  .object({
    connectionType: z.enum(['none', 'secret', 'oauth2-code']),
    label: z.string().min(1, 'Label is required'),
    description: z.string().optional().or(z.literal('')),

    // OAuth2 fields - conditionally validated
    oauth2AuthorizeUrl: z
      .string()
      .refine((val) => !val || val === '' || z.string().url().safeParse(val).success, {
        message: 'Must be a valid URL',
      })
      .optional()
      .or(z.literal('')),
    oauth2AccessTokenUrl: z
      .string()
      .refine((val) => !val || val === '' || z.string().url().safeParse(val).success, {
        message: 'Must be a valid URL',
      })
      .optional()
      .or(z.literal('')),
    oauth2ClientId: z.string().optional().or(z.literal('')),
    oauth2ClientSecret: z.string().optional().or(z.literal('')),
    oauth2Scopes: z.string().optional().or(z.literal('')), // Comma-separated, optional
    oauth2TokenRequestAuthMethod: z.enum(['request-body', 'basic-auth']).optional(),
    oauth2RefreshSchedule: z.enum(['none', 'hourly', 'daily', 'weekly']).optional(),
    oauth2Pkce: z.boolean().optional(),
    oauth2CallbackBaseUrl: z
      .string()
      .refine((val) => !val || val === '' || z.string().url().safeParse(val).success, {
        message: 'Must be a valid URL',
      })
      .optional()
      .or(z.literal('')),
    oauth2ScopeSeparator: z.string().optional().or(z.literal('')),
    oauth2AdditionalAuthorizeParams: z
      .string()
      .refine(
        (val) => {
          if (!val || val === '') return true
          try {
            const parsed = JSON.parse(val)
            return typeof parsed === 'object' && !Array.isArray(parsed)
          } catch {
            return false
          }
        },
        { message: 'Must be a valid JSON object (e.g. {"key": "value"})' }
      )
      .optional()
      .or(z.literal('')),
    oauth2AdditionalTokenParams: z
      .string()
      .refine(
        (val) => {
          if (!val || val === '') return true
          try {
            const parsed = JSON.parse(val)
            return typeof parsed === 'object' && !Array.isArray(parsed)
          } catch {
            return false
          }
        },
        { message: 'Must be a valid JSON object (e.g. {"key": "value"})' }
      )
      .optional()
      .or(z.literal('')),
    oauth2CallbackMetadataParams: z.string().optional().or(z.literal('')),
  })
  .refine(
    (data) => {
      // If oauth2-code is selected, required OAuth2 fields (except scopes)
      if (data.connectionType === 'oauth2-code') {
        return (
          data.oauth2AuthorizeUrl &&
          data.oauth2AccessTokenUrl &&
          data.oauth2ClientId &&
          data.oauth2ClientSecret &&
          data.oauth2TokenRequestAuthMethod
        )
      }
      return true
    },
    {
      message: 'Required OAuth2 fields must be filled when OAuth2 is selected',
      path: ['connectionType'],
    }
  )

type ConnectionFormData = z.infer<typeof connectionFormSchema>

/** Convert refresh schedule enum to seconds */
function convertScheduleToSeconds(schedule: string | undefined): number | undefined {
  if (!schedule || schedule === 'none') return undefined

  const scheduleMap = {
    hourly: 3600,
    daily: 86400,
    weekly: 604800,
  }

  return scheduleMap[schedule as keyof typeof scheduleMap]
}

/** Convert seconds to refresh schedule enum */
function convertSecondsToSchedule(
  seconds: number | null | undefined
): 'none' | 'hourly' | 'daily' | 'weekly' {
  if (!seconds) return 'none'

  if (seconds === 3600) return 'hourly'
  if (seconds === 86400) return 'daily'
  if (seconds === 604800) return 'weekly'

  return 'none'
}

/** Split scopes string into array (handles comma-separated, space-separated, or mixed) */
function parseScopesString(scopes: string): string[] {
  if (!scopes) return []
  return scopes
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Convert scopes array to comma-separated string */
function formatScopesArray(scopes: string[] | null | undefined): string {
  if (!scopes || scopes.length === 0) return ''
  return scopes.join(', ')
}

/** Connections page component */
export default function ConnectionsPage() {
  const { app_slug } = useParams<{ app_slug: string }>()
  const utils = api.useUtils()
  const hasLoadedConnection = useRef(false)

  // Get app data
  const { data: app, isLoading: isLoadingApp } = api.apps.get.useQuery({
    slug: app_slug,
  })

  // Get existing connection config
  const { data: connection, isLoading: isLoadingConnection } = api.connections.get.useQuery(
    {
      appId: app?.id ?? '',
      version: 1,
      global: true,
    },
    {
      enabled: !!app?.id,
    }
  )

  // Form setup
  const form = useForm<ConnectionFormData>({
    resolver: standardSchemaResolver(connectionFormSchema),
    defaultValues: {
      connectionType: 'none',
      label: 'API Connection',
      description: '',
      oauth2AuthorizeUrl: '',
      oauth2AccessTokenUrl: '',
      oauth2ClientId: '',
      oauth2ClientSecret: '',
      oauth2Scopes: '',
      oauth2TokenRequestAuthMethod: 'request-body',
      oauth2RefreshSchedule: 'none',
      oauth2Pkce: false,
      oauth2CallbackBaseUrl: '',
      oauth2ScopeSeparator: '',
      oauth2AdditionalAuthorizeParams: '',
      oauth2AdditionalTokenParams: '',
      oauth2CallbackMetadataParams: '',
    },
  })

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    control,
    watch,
  } = form

  const [showAdvanced, setShowAdvanced] = useState(false)

  // Watch form fields - using watch instead of useWatch to avoid timing issues with reset
  const connectionType = watch('connectionType') || 'none'

  // Load existing data into form (only once when connection data is first available)
  useEffect(() => {
    if (connection && !hasLoadedConnection.current) {
      const scheduleValue = convertSecondsToSchedule(connection.oauth2RefreshTokenIntervalSeconds)
      const connectionTypeValue = connection.connectionType as 'none' | 'secret' | 'oauth2-code'
      const features = (connection.oauth2Features as Record<string, unknown>) ?? {}

      reset({
        connectionType: connectionTypeValue,
        label: connection.label,
        description: connection.description || '',
        oauth2AuthorizeUrl: connection.oauth2AuthorizeUrl || '',
        oauth2AccessTokenUrl: connection.oauth2AccessTokenUrl || '',
        oauth2ClientId: connection.oauth2ClientId || '',
        oauth2ClientSecret: connection.oauth2ClientSecret || '',
        oauth2Scopes: formatScopesArray(connection.oauth2Scopes as string[]),
        oauth2TokenRequestAuthMethod:
          (connection.oauth2TokenRequestAuthMethod as 'request-body' | 'basic-auth') ||
          'request-body',
        oauth2RefreshSchedule: scheduleValue,
        oauth2Pkce: (features.pkce as boolean) ?? false,
        oauth2CallbackBaseUrl: (features.callbackBaseUrl as string) ?? '',
        oauth2ScopeSeparator: (features.scopeSeparator as string) ?? '',
        oauth2AdditionalAuthorizeParams: features.additionalAuthorizeParams
          ? JSON.stringify(features.additionalAuthorizeParams, null, 2)
          : '',
        oauth2AdditionalTokenParams: features.additionalTokenParams
          ? JSON.stringify(features.additionalTokenParams, null, 2)
          : '',
        oauth2CallbackMetadataParams:
          (features.callbackMetadataParams as string[])?.join(', ') ?? '',
      })

      // Auto-open advanced section if any advanced field has a value
      if (
        features.pkce ||
        features.callbackBaseUrl ||
        features.scopeSeparator ||
        features.additionalAuthorizeParams ||
        features.additionalTokenParams ||
        (features.callbackMetadataParams as string[])?.length
      ) {
        setShowAdvanced(true)
      }

      hasLoadedConnection.current = true
    }
  }, [connection, reset])

  // Upsert mutation
  const upsertConnection = api.connections.upsert.useMutation({
    onSuccess: () => {
      hasLoadedConnection.current = false
      utils.connections.get.invalidate({
        appId: app?.id ?? '',
        version: 1,
        global: true,
      })
    },
    onError: (error) => {
      toastError({
        title: 'Failed to save connection',
        description: error.message,
      })
    },
  })

  // Computed value for conditional rendering
  const isOAuth2 = connectionType === 'oauth2-code'

  // Form submission handler
  const onSubmit = async (data: ConnectionFormData) => {
    if (!app) return

    // Parse scopes from comma-separated string to array
    const scopesArray = parseScopesString(data.oauth2Scopes || '')

    // Convert refresh schedule to seconds
    const refreshSeconds = convertScheduleToSeconds(data.oauth2RefreshSchedule)

    // Build mutation payload
    const payload = {
      appId: app.id,
      version: 1,
      global: true,
      connectionType: data.connectionType,
      label: data.label,
      description: data.description,

      // Only include OAuth2 fields if connectionType is oauth2-code
      ...(data.connectionType === 'oauth2-code' && {
        oauth2AuthorizeUrl: data.oauth2AuthorizeUrl,
        oauth2AccessTokenUrl: data.oauth2AccessTokenUrl,
        oauth2ClientId: data.oauth2ClientId,
        oauth2ClientSecret: data.oauth2ClientSecret,
        oauth2Scopes: scopesArray,
        oauth2TokenRequestAuthMethod: data.oauth2TokenRequestAuthMethod,
        oauth2RefreshTokenIntervalSeconds: refreshSeconds,
        oauth2Features: {
          ...(data.oauth2Pkce && { pkce: true }),
          ...(data.oauth2CallbackBaseUrl && { callbackBaseUrl: data.oauth2CallbackBaseUrl }),
          ...(data.oauth2ScopeSeparator && { scopeSeparator: data.oauth2ScopeSeparator }),
          ...(data.oauth2AdditionalAuthorizeParams && {
            additionalAuthorizeParams: JSON.parse(data.oauth2AdditionalAuthorizeParams),
          }),
          ...(data.oauth2AdditionalTokenParams && {
            additionalTokenParams: JSON.parse(data.oauth2AdditionalTokenParams),
          }),
          ...(data.oauth2CallbackMetadataParams && {
            callbackMetadataParams: data.oauth2CallbackMetadataParams
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
          }),
        },
      }),
    }

    await upsertConnection.mutateAsync(payload)
  }

  // Loading state
  if (isLoadingApp || isLoadingConnection) {
    return (
      <div className='flex flex-col items-center justify-center flex-1 overflow-y-auto'>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Loader2 className='animate-spin' />
            </EmptyMedia>
            <EmptyTitle>Loading...</EmptyTitle>
            <EmptyDescription>Fetching connection settings</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  // Error state
  if (!app) {
    return (
      <div className='flex flex-col items-center justify-center flex-1 overflow-y-auto'>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <X />
            </EmptyMedia>
            <EmptyTitle>Error...</EmptyTitle>
            <EmptyDescription>Failed to load app</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className='flex flex-col items-center justify-start gap-1 py-10 px-4 overflow-y-auto'>
      <div className='max-w-3xl w-full mx-auto'>
        <form onSubmit={handleSubmit(onSubmit)}>
          <FieldGroup>
            <FieldSet>
              <FieldLegend>Connections</FieldLegend>
              <FieldDescription>
                Configure how this auxx.ai app connects to your product. Auxx.ai will manage the
                connection, including asking the user to create one after they install the app, and
                provide access to the connection via the App SDK so you can make authenticated calls
                to your product from within this app. Learn more
              </FieldDescription>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Organization connection</FieldLegend>
              <FieldDescription>
                Defines how your app stores a connection to a third-party service for the whole
                organization.
              </FieldDescription>

              <FieldGroup>
                <Field>
                  <Controller
                    name='connectionType'
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value || 'none'}
                        defaultValue={field.value || 'none'}
                        onValueChange={(value) => {
                          // Only call onChange if we have a valid value
                          if (value && value.trim() !== '') {
                            field.onChange(value)
                          }
                        }}>
                        <SelectTrigger id='app-organization-auth-method'>
                          <SelectValue placeholder='Select a method...' />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='none'>None</SelectItem>
                          <SelectItem value='secret'>Secret</SelectItem>
                          <SelectItem value='oauth2-code'>OAuth 2.0</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.connectionType && (
                    <p className='text-sm text-red-600 mt-1'>{errors.connectionType.message}</p>
                  )}
                </Field>
              </FieldGroup>

              {isOAuth2 && (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor='app-organization-authorize-url'>Authorize URL</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id='app-organization-authorize-url'
                        placeholder='https://auth-server.com/oauth/authorize'
                        aria-invalid={!!errors.oauth2AuthorizeUrl}
                        {...register('oauth2AuthorizeUrl')}
                      />
                      <InputGroupAddon align='inline-end'>
                        {errors.oauth2AuthorizeUrl && (
                          <TooltipError text={errors.oauth2AuthorizeUrl.message ?? ''} />
                        )}
                        <TooltipExplanation
                          text='The URL where users are redirected to grant authorization to your app.'
                          side='right'
                        />
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor='app-organization-token-url'>Access token URL</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id='app-organization-token-url'
                        placeholder='https://auth-server.com/oauth/token'
                        aria-invalid={!!errors.oauth2AccessTokenUrl}
                        {...register('oauth2AccessTokenUrl')}
                      />
                      <InputGroupAddon align='inline-end'>
                        {errors.oauth2AccessTokenUrl && (
                          <TooltipError text={errors.oauth2AccessTokenUrl.message ?? ''} />
                        )}
                        <TooltipExplanation
                          text='The URL used to exchange the authorization code for an access token.'
                          side='right'
                        />
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor='app-organization-client-id'>Client ID</FieldLabel>
                    <Input
                      id='app-organization-client-id'
                      placeholder=''
                      {...register('oauth2ClientId')}
                    />
                    {errors.oauth2ClientId && (
                      <p className='text-sm text-red-600 mt-1'>{errors.oauth2ClientId.message}</p>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor='app-organization-client-secret'>Client secret</FieldLabel>
                    <Input
                      id='app-organization-client-secret'
                      placeholder=''
                      type='password'
                      {...register('oauth2ClientSecret')}
                    />
                    {errors.oauth2ClientSecret && (
                      <p className='text-sm text-red-600 mt-1'>
                        {errors.oauth2ClientSecret.message}
                      </p>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor='app-organization-scopes'>Scopes</FieldLabel>
                    <Input
                      id='app-organization-scopes'
                      placeholder='read:user, write:data'
                      {...register('oauth2Scopes')}
                    />
                    <FieldDescription>
                      Enter comma-separated scopes (e.g., read:user, write:data)
                    </FieldDescription>
                    {errors.oauth2Scopes && (
                      <p className='text-sm text-red-600 mt-1'>{errors.oauth2Scopes.message}</p>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor='app-organization-request-method'>
                      Token request authentication method
                    </FieldLabel>

                    <Controller
                      name='oauth2TokenRequestAuthMethod'
                      control={control}
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id='app-organization-request-method'>
                            <SelectValue placeholder='Select a method...' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='request-body'>Body</SelectItem>
                            <SelectItem value='basic-auth'>Basic Auth</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.oauth2TokenRequestAuthMethod && (
                      <p className='text-sm text-red-600 mt-1'>
                        {errors.oauth2TokenRequestAuthMethod.message}
                      </p>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor='app-organization-refresh-schedule'>
                      Access token refresh schedule
                    </FieldLabel>
                    <Controller
                      name='oauth2RefreshSchedule'
                      control={control}
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id='app-organization-refresh-schedule'>
                            <SelectValue placeholder='Select a refresh schedule...' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='none'>None</SelectItem>
                            <SelectItem value='hourly'>Hourly</SelectItem>
                            <SelectItem value='daily'>Daily</SelectItem>
                            <SelectItem value='weekly'>Weekly</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.oauth2RefreshSchedule && (
                      <p className='text-sm text-red-600 mt-1'>
                        {errors.oauth2RefreshSchedule.message}
                      </p>
                    )}
                  </Field>
                  <FieldSet>
                    <div className='flex items-center gap-3'>
                      <Switch
                        id='app-organization-advanced'
                        checked={showAdvanced}
                        onCheckedChange={setShowAdvanced}
                      />
                      <FieldLabel htmlFor='app-organization-advanced'>Advanced settings</FieldLabel>
                    </div>

                    {showAdvanced && (
                      <FieldGroup>
                        <Field>
                          <div className='flex items-center gap-3'>
                            <Controller
                              name='oauth2Pkce'
                              control={control}
                              render={({ field }) => (
                                <Switch
                                  id='app-organization-pkce'
                                  checked={field.value ?? false}
                                  onCheckedChange={field.onChange}
                                />
                              )}
                            />
                            <FieldLabel htmlFor='app-organization-pkce'>Use PKCE (S256)</FieldLabel>
                          </div>
                          <FieldDescription>
                            Enable Proof Key for Code Exchange (RFC 7636). Required by Airtable,
                            Zoom, Twitter/X, Linear, Figma, and other providers.
                          </FieldDescription>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor='app-organization-callback-base-url'>
                            Callback base URL
                          </FieldLabel>
                          <Input
                            id='app-organization-callback-base-url'
                            placeholder='https://example.ngrok-free.app'
                            {...register('oauth2CallbackBaseUrl')}
                          />
                          <FieldDescription>
                            Override the callback redirect URL base. Falls back to WEBAPP_URL if
                            empty.
                          </FieldDescription>
                          {errors.oauth2CallbackBaseUrl && (
                            <p className='text-sm text-red-600 mt-1'>
                              {errors.oauth2CallbackBaseUrl.message}
                            </p>
                          )}
                        </Field>
                        <Field>
                          <FieldLabel htmlFor='app-organization-scope-separator'>
                            Scope separator
                          </FieldLabel>
                          <Input
                            id='app-organization-scope-separator'
                            placeholder='(space by default)'
                            {...register('oauth2ScopeSeparator')}
                          />
                          <FieldDescription>
                            Character used to separate scopes in the authorize URL. Defaults to a
                            space if empty.
                          </FieldDescription>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor='app-organization-additional-authorize-params'>
                            Additional authorize params
                          </FieldLabel>
                          <Textarea
                            id='app-organization-additional-authorize-params'
                            placeholder='{"prompt": "consent"}'
                            rows={3}
                            {...register('oauth2AdditionalAuthorizeParams')}
                          />
                          <FieldDescription>
                            JSON object of extra query params appended to the authorize URL.
                          </FieldDescription>
                          {errors.oauth2AdditionalAuthorizeParams && (
                            <p className='text-sm text-red-600 mt-1'>
                              {errors.oauth2AdditionalAuthorizeParams.message}
                            </p>
                          )}
                        </Field>
                        <Field>
                          <FieldLabel htmlFor='app-organization-additional-token-params'>
                            Additional token params
                          </FieldLabel>
                          <Textarea
                            id='app-organization-additional-token-params'
                            placeholder='{"audience": "https://api.example.com"}'
                            rows={3}
                            {...register('oauth2AdditionalTokenParams')}
                          />
                          <FieldDescription>
                            JSON object of extra params appended to the token exchange request body.
                          </FieldDescription>
                          {errors.oauth2AdditionalTokenParams && (
                            <p className='text-sm text-red-600 mt-1'>
                              {errors.oauth2AdditionalTokenParams.message}
                            </p>
                          )}
                        </Field>
                        <Field>
                          <FieldLabel htmlFor='app-organization-callback-metadata-params'>
                            Callback metadata params
                          </FieldLabel>
                          <Input
                            id='app-organization-callback-metadata-params'
                            placeholder='realmId, tenantId'
                            {...register('oauth2CallbackMetadataParams')}
                          />
                          <FieldDescription>
                            Comma-separated list of callback URL query params to capture and store
                            as connection metadata. These are available at runtime via
                            connection.metadata.
                          </FieldDescription>
                        </Field>
                      </FieldGroup>
                    )}
                  </FieldSet>
                </FieldGroup>
              )}
            </FieldSet>

            <Field orientation='horizontal'>
              <Button
                type='submit'
                size='sm'
                loading={upsertConnection.isPending}
                loadingText='Saving...'
                disabled={!isDirty || upsertConnection.isPending}>
                Save Connection
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </div>
    </div>
  )
}
