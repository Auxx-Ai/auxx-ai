// apps/build/src/app/(portal)/[slug]/apps/[app_slug]/connections/page.tsx
'use client'

import { HIDDEN_VALUE } from '@auxx/credentials/crypto/client'
import type { AuthApply, ConnectionVariable } from '@auxx/database'
import { Badge } from '@auxx/ui/components/badge'
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Separator } from '@auxx/ui/components/separator'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import { TooltipError, TooltipExplanation } from '@auxx/ui/components/tooltip'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { toastError } from '~/components/global/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { ConnectionVariableDialog } from './connection-variable-dialog'

/** Slugish method key: lowercase letters/digits/underscore, e.g. 'api_key', 'oauth2'. */
const KEY_PATTERN = /^[a-z0-9_]+$/

/** Connection form validation schema */
const connectionFormSchema = z
  .object({
    methodKey: z
      .string()
      .min(1, 'Key is required')
      .regex(KEY_PATTERN, 'Use lowercase letters, digits, and underscores'),
    global: z.boolean(),
    connectionType: z.enum(['none', 'secret', 'oauth2-code', 'client-credentials']),
    label: z.string().min(1, 'Label is required'),
    description: z.string().optional().or(z.literal('')),

    // OAuth2 fields - conditionally validated
    oauth2AuthorizeUrl: z
      .string()
      .refine(
        (val) => {
          if (!val || val === '') return true
          if (/\{[^}]+\}/.test(val)) return true
          return z.string().url().safeParse(val).success
        },
        { message: 'Must be a valid URL or contain {variable} placeholders' }
      )
      .optional()
      .or(z.literal('')),
    oauth2AccessTokenUrl: z
      .string()
      .refine(
        (val) => {
          if (!val || val === '') return true
          if (/\{[^}]+\}/.test(val)) return true
          return z.string().url().safeParse(val).success
        },
        { message: 'Must be a valid URL or contain {variable} placeholders' }
      )
      .optional()
      .or(z.literal('')),
    oauth2RefreshUrl: z
      .string()
      .refine(
        (val) => {
          if (!val || val === '') return true
          if (/\{[^}]+\}/.test(val)) return true
          return z.string().url().safeParse(val).success
        },
        { message: 'Must be a valid URL or contain {variable} placeholders' }
      )
      .optional()
      .or(z.literal('')),
    oauth2ClientId: z.string().optional().or(z.literal('')),
    oauth2ClientSecret: z.string().optional().or(z.literal('')),
    oauth2Scopes: z.string().optional().or(z.literal('')), // Comma-separated, optional
    // Additive scopes an organization may request on top of the required list. Comma-separated,
    // optional, and disjoint from `oauth2Scopes` (enforced by the refine below).
    oauth2OptionalScopes: z.string().optional().or(z.literal('')),
    oauth2TokenRequestAuthMethod: z.enum(['request-body', 'basic-auth']).optional(),
    oauth2RefreshSchedule: z.enum(['none', 'hourly', 'daily', 'weekly']).optional(),
    oauth2Pkce: z.boolean().optional(),
    // When true, the platform OAuth client is pending verification, so organizations may
    // connect with it OR bring their own client id/secret (persisted as platformClientApproved=false).
    oauth2AllowOwnClient: z.boolean().optional(),
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

    // How the resolved credential is attached to outgoing requests, + the base-URL
    // template the connection contributes (both apply to secret + oauth2 methods).
    authApplyMode: z.enum(['none', 'bearer', 'header', 'query', 'basic', 'advanced']).optional(),
    authHeaderName: z.string().optional().or(z.literal('')),
    authHeaderFormat: z.string().optional().or(z.literal('')),
    authQueryName: z.string().optional().or(z.literal('')),
    authQueryFormat: z.string().optional().or(z.literal('')),
    authBasicUserField: z.string().optional().or(z.literal('')),
    authBasicPasswordField: z.string().optional().or(z.literal('')),
    baseUrlTemplate: z.string().optional().or(z.literal('')),
  })
  .refine(
    (data) => {
      // oauth2-code needs the full browser flow (authorize URL + token mint).
      if (data.connectionType === 'oauth2-code') {
        return (
          data.oauth2AuthorizeUrl &&
          data.oauth2AccessTokenUrl &&
          data.oauth2ClientId &&
          data.oauth2ClientSecret &&
          data.oauth2TokenRequestAuthMethod
        )
      }
      // client-credentials mints with no browser step — same fields minus the authorize URL.
      if (data.connectionType === 'client-credentials') {
        return (
          data.oauth2AccessTokenUrl &&
          data.oauth2ClientId &&
          data.oauth2ClientSecret &&
          data.oauth2TokenRequestAuthMethod
        )
      }
      return true
    },
    {
      message: 'Required OAuth2 fields must be filled when an OAuth2 method is selected',
      path: ['connectionType'],
    }
  )
  .superRefine((data, ctx) => {
    // The two lists are disjoint by design: `oauth2Scopes` is the floor (always requested) and
    // `oauth2OptionalScopes` is additive (requested only when a connect attempt names it), so a
    // scope in both has no meaning. Compare normalized so 'read_orders, ' equals 'read_orders'.
    const required = new Set(parseScopesString(data.oauth2Scopes || ''))
    const overlap = [
      ...new Set(parseScopesString(data.oauth2OptionalScopes || '').filter((s) => required.has(s))),
    ]
    if (overlap.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `Optional scopes must not repeat a required scope: ${overlap.join(', ')}`,
        path: ['oauth2OptionalScopes'],
      })
    }
  })

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

const TYPE_LABELS: Record<string, string> = {
  'oauth2-code': 'OAuth 2.0',
  'client-credentials': 'OAuth 2.0 (Machine-to-machine)',
  secret: 'Secret',
  none: 'None',
}

/** The canonical bearer spec — recognized so it round-trips as the 'bearer' preset. */
function isBearerSpec(spec: AuthApply): boolean {
  return (
    'in' in spec &&
    spec.in === 'header' &&
    spec.name === 'Authorization' &&
    spec.format === 'Bearer {value}'
  )
}

/** Form-control subset that mirrors a single-insertion `AuthApply`. */
type AuthApplyFormFields = Pick<
  ConnectionFormData,
  | 'authApplyMode'
  | 'authHeaderName'
  | 'authHeaderFormat'
  | 'authQueryName'
  | 'authQueryFormat'
  | 'authBasicUserField'
  | 'authBasicPasswordField'
>

/** Decompose a stored `AuthApply` into the form's mode + per-mode inputs. */
function authApplyToForm(spec: AuthApply | null | undefined): AuthApplyFormFields {
  if (!spec) return { authApplyMode: 'none' }
  // Multi-insertion specs (e.g. dual-header) aren't editable in this single-insertion
  // form — surface them read-only and preserve the value verbatim on save.
  if ('insertions' in spec) return { authApplyMode: 'advanced' }
  if (isBearerSpec(spec)) return { authApplyMode: 'bearer' }
  switch (spec.in) {
    case 'header':
      return { authApplyMode: 'header', authHeaderName: spec.name, authHeaderFormat: spec.format }
    case 'query':
      return { authApplyMode: 'query', authQueryName: spec.name, authQueryFormat: spec.format }
    case 'basic':
      return {
        authApplyMode: 'basic',
        authBasicUserField: spec.userField,
        authBasicPasswordField: spec.passwordField,
      }
  }
}

/**
 * Build the `AuthApply` to persist from the form. `advanced` (a multi-insertion spec the
 * form can't edit) returns the untouched original so external config isn't clobbered.
 */
function formToAuthApply(data: ConnectionFormData, loaded: AuthApply | null): AuthApply | null {
  switch (data.authApplyMode) {
    case 'bearer':
      return { in: 'header', name: 'Authorization', format: 'Bearer {value}' }
    case 'header':
      return {
        in: 'header',
        name: data.authHeaderName || 'Authorization',
        format: data.authHeaderFormat || undefined,
      }
    case 'query':
      return {
        in: 'query',
        name: data.authQueryName || 'api_key',
        format: data.authQueryFormat || undefined,
      }
    case 'basic':
      return {
        in: 'basic',
        userField: data.authBasicUserField || undefined,
        passwordField: data.authBasicPasswordField || undefined,
      }
    case 'advanced':
      return loaded
    default:
      return null
  }
}

/**
 * Editor for a single connection method. `methodId === null` creates a new method (key is
 * editable); otherwise it edits an existing row by id (key is immutable). The form body is the
 * same OAuth/secret/variables editor as before — only its identity (key + scope) is new.
 */
function MethodEditor({
  appId,
  methodId,
  onClose,
}: {
  appId: string
  methodId: string | null
  onClose: () => void
}) {
  const isCreate = methodId === null
  const utils = api.useUtils()
  const hasLoadedConnection = useRef(false)
  // The server prefills a *masked* secret — if it's submitted unchanged, send the sentinel so
  // the stored value is kept (the mask itself must never be persisted).
  const maskedSecretPrefill = useRef('')

  const { data: connection, isLoading: isLoadingConnection } = api.connections.get.useQuery(
    { connectionDefinitionId: methodId ?? '' },
    { enabled: !isCreate && !!methodId }
  )

  const form = useForm<ConnectionFormData>({
    resolver: standardSchemaResolver(connectionFormSchema),
    defaultValues: {
      methodKey: '',
      global: true,
      connectionType: 'none',
      label: 'API Connection',
      description: '',
      oauth2AuthorizeUrl: '',
      oauth2AccessTokenUrl: '',
      oauth2RefreshUrl: '',
      oauth2ClientId: '',
      oauth2ClientSecret: '',
      oauth2Scopes: '',
      oauth2OptionalScopes: '',
      oauth2TokenRequestAuthMethod: 'request-body',
      oauth2RefreshSchedule: 'none',
      oauth2Pkce: false,
      oauth2AllowOwnClient: false,
      oauth2CallbackBaseUrl: '',
      oauth2ScopeSeparator: '',
      oauth2AdditionalAuthorizeParams: '',
      oauth2AdditionalTokenParams: '',
      oauth2CallbackMetadataParams: '',
      // A new method defaults to Bearer — correct for OAuth2 and the common API-key case.
      authApplyMode: 'bearer',
      authHeaderName: '',
      authHeaderFormat: '',
      authQueryName: '',
      authQueryFormat: '',
      authBasicUserField: '',
      authBasicPasswordField: '',
      baseUrlTemplate: '',
    },
  })

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    control,
    watch,
    setValue,
  } = form

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [connectionVariables, setConnectionVariables] = useState<ConnectionVariable[]>([])
  const [variableDialogOpen, setVariableDialogOpen] = useState(false)
  const [variablesDirty, setVariablesDirty] = useState(false)
  // Eye toggle flips the input type; it only ever exposes the mask (or what the user typed).
  // The real secret comes back exclusively via the audited reveal mutation below.
  const [secretVisible, setSecretVisible] = useState(false)
  const revealedSecret = useRef<string | null>(null)
  // The loaded `authApply` verbatim — preserved on save for multi-insertion ('advanced')
  // specs the single-insertion form can't represent.
  const loadedAuthApply = useRef<AuthApply | null>(null)
  // Request-auth / base-URL fields live on their own sub-page within the editor,
  // reached from a nav row in the main view (mirrors the "Back to methods" pattern).
  const [subView, setSubView] = useState<'main' | 'auth'>('main')

  const connectionType = watch('connectionType') || 'none'

  // Load existing data into form (only once when connection data is first available)
  useEffect(() => {
    if (connection && !hasLoadedConnection.current) {
      const scheduleValue = convertSecondsToSchedule(connection.oauth2RefreshTokenIntervalSeconds)
      const connectionTypeValue = connection.connectionType as
        | 'none'
        | 'secret'
        | 'oauth2-code'
        | 'client-credentials'
      const features = (connection.oauth2Features as Record<string, unknown>) ?? {}

      maskedSecretPrefill.current = connection.oauth2ClientSecret || ''

      const storedAuthApply = (connection.authApply as AuthApply | null) ?? null
      loadedAuthApply.current = storedAuthApply
      const authForm = authApplyToForm(storedAuthApply)

      reset({
        methodKey: connection.key ?? '',
        global: connection.global ?? true,
        connectionType: connectionTypeValue,
        label: connection.label,
        description: connection.description || '',
        oauth2AuthorizeUrl: connection.oauth2AuthorizeUrl || '',
        oauth2AccessTokenUrl: connection.oauth2AccessTokenUrl || '',
        oauth2RefreshUrl: connection.oauth2RefreshUrl || '',
        oauth2ClientId: connection.oauth2ClientId || '',
        oauth2ClientSecret: connection.oauth2ClientSecret || '',
        oauth2Scopes: formatScopesArray(connection.oauth2Scopes as string[]),
        oauth2OptionalScopes: formatScopesArray(connection.oauth2OptionalScopes as string[]),
        oauth2TokenRequestAuthMethod:
          (connection.oauth2TokenRequestAuthMethod as 'request-body' | 'basic-auth') ||
          'request-body',
        oauth2RefreshSchedule: scheduleValue,
        oauth2Pkce: (features.pkce as boolean) ?? false,
        oauth2AllowOwnClient: connection.platformClientApproved === false,
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
        authApplyMode: authForm.authApplyMode,
        authHeaderName: authForm.authHeaderName ?? '',
        authHeaderFormat: authForm.authHeaderFormat ?? '',
        authQueryName: authForm.authQueryName ?? '',
        authQueryFormat: authForm.authQueryFormat ?? '',
        authBasicUserField: authForm.authBasicUserField ?? '',
        authBasicPasswordField: authForm.authBasicPasswordField ?? '',
        baseUrlTemplate: connection.baseUrlTemplate ?? '',
      })

      // Connection variables are a top-level column (shared by oauth2-code and secret)
      setConnectionVariables((connection.connectionVariables as ConnectionVariable[]) ?? [])

      // Auto-open advanced section if any advanced field has a value
      if (
        connection.oauth2RefreshUrl ||
        features.pkce ||
        features.callbackBaseUrl ||
        features.scopeSeparator ||
        features.additionalAuthorizeParams ||
        features.additionalTokenParams ||
        (features.callbackMetadataParams as string[])?.length ||
        connection.platformClientApproved === false
      ) {
        setShowAdvanced(true)
      }

      hasLoadedConnection.current = true
    }
  }, [connection, reset])

  const onSaved = () => {
    utils.connections.list.invalidate({ appId })
    if (methodId) utils.connections.get.invalidate({ connectionDefinitionId: methodId })
    onClose()
  }

  const createMethod = api.connections.create.useMutation({
    onSuccess: onSaved,
    onError: (error) =>
      toastError({ title: 'Failed to save connection', description: error.message }),
  })
  const updateMethod = api.connections.update.useMutation({
    onSuccess: onSaved,
    onError: (error) =>
      toastError({ title: 'Failed to save connection', description: error.message }),
  })
  const isSaving = createMethod.isPending || updateMethod.isPending

  // Reveal-on-demand ("dev lost the secret" recovery) — server audits every reveal.
  const revealClientSecret = api.connections.revealClientSecret.useMutation({
    onSuccess: ({ clientSecret: revealed }) => {
      if (!revealed) return
      revealedSecret.current = revealed
      setValue('oauth2ClientSecret', revealed)
      setSecretVisible(true)
    },
    onError: (error) => {
      toastError({ title: 'Failed to reveal client secret', description: error.message })
    },
  })

  const isOAuth2 = connectionType === 'oauth2-code'
  const isClientCredentials = connectionType === 'client-credentials'
  const isSecret = connectionType === 'secret'
  // Both OAuth2 grants mint a token (and thus show the token URL / client id+secret / scopes
  // fields); only oauth2-code additionally drives the browser redirect (authorize URL, PKCE…).
  const mintsToken = isOAuth2 || isClientCredentials
  const authApplyMode = watch('authApplyMode') || 'none'

  const authorizeUrl = watch('oauth2AuthorizeUrl') || ''
  const tokenUrl = watch('oauth2AccessTokenUrl') || ''
  const clientId = watch('oauth2ClientId') || ''
  const clientSecret = watch('oauth2ClientSecret') || ''

  // Reveal only applies while the field still shows the untouched masked prefill.
  const canReveal = !!maskedSecretPrefill.current && clientSecret === maskedSecretPrefill.current

  const secretRegister = register('oauth2ClientSecret')

  const detectedPlaceholders = useMemo(() => {
    // client-credentials interpolates the token URL + client id/secret (no authorize URL).
    const allFields = [mintsToken ? authorizeUrl : '', tokenUrl, clientId, clientSecret].join(' ')
    const matches = allFields.match(/\{([^}]+)\}/g)
    if (!matches) return []
    const keys = [...new Set(matches.map((m) => m.slice(1, -1)))]
    return keys.filter((k) => !connectionVariables.some((v) => v.key === k))
  }, [mintsToken, authorizeUrl, tokenUrl, clientId, clientSecret, connectionVariables])

  const handleVariablesChange = (vars: ConnectionVariable[]) => {
    setConnectionVariables(vars)
    setVariablesDirty(true)
  }

  const onSubmit = async (data: ConnectionFormData) => {
    const scopesArray = parseScopesString(data.oauth2Scopes || '')
    const optionalScopesArray = parseScopesString(data.oauth2OptionalScopes || '')
    const refreshSeconds = convertScheduleToSeconds(data.oauth2RefreshSchedule)
    const mintsTokenType =
      data.connectionType === 'oauth2-code' || data.connectionType === 'client-credentials'

    // Fields shared by create + update (everything except identity).
    const fields = {
      global: data.global,
      connectionType: data.connectionType,
      label: data.label,
      description: data.description,

      // Connection variables, request auth, and base-URL template apply to every connecting
      // method (oauth2-code interpolation, client-credentials id/secret, secret connect form).
      // `none` methods omit them → the router stores null.
      ...(data.connectionType !== 'none' && {
        connectionVariables,
        authApply: formToAuthApply(data, loadedAuthApply.current),
        baseUrlTemplate: data.baseUrlTemplate || undefined,
      }),

      // Token-minting fields — written for both oauth2-code and client-credentials.
      ...(mintsTokenType && {
        oauth2AccessTokenUrl: data.oauth2AccessTokenUrl,
        oauth2RefreshUrl: data.oauth2RefreshUrl,
        oauth2ClientId: data.oauth2ClientId,
        oauth2ClientSecret:
          maskedSecretPrefill.current && data.oauth2ClientSecret === maskedSecretPrefill.current
            ? HIDDEN_VALUE
            : data.oauth2ClientSecret,
        oauth2Scopes: scopesArray,
        oauth2OptionalScopes: optionalScopesArray,
        oauth2TokenRequestAuthMethod: data.oauth2TokenRequestAuthMethod,
        oauth2RefreshTokenIntervalSeconds: refreshSeconds,
      }),

      // Browser-redirect fields — oauth2-code only (client-credentials has no authorize step).
      ...(data.connectionType === 'oauth2-code' && {
        oauth2AuthorizeUrl: data.oauth2AuthorizeUrl,
        // Own-client gate: "allow own client" toggles the platform client into pending-approval,
        // which the connect flow renders as platform-login OR bring-your-own.
        platformClientApproved: !data.oauth2AllowOwnClient,
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

    if (isCreate) {
      await createMethod.mutateAsync({ appId, version: 1, key: data.methodKey, ...fields })
    } else if (methodId) {
      await updateMethod.mutateAsync({ connectionDefinitionId: methodId, ...fields })
    }
  }

  if (!isCreate && isLoadingConnection) {
    return (
      <div className='flex flex-col items-center justify-center flex-1 py-10'>
        <Loader2 className='animate-spin text-muted-foreground' />
      </div>
    )
  }

  return (
    <div className='max-w-3xl w-full mx-auto'>
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='mb-4'
        onClick={subView === 'auth' ? () => setSubView('main') : onClose}>
        <ArrowLeft />
        {subView === 'auth' ? 'Back to method' : 'Back to methods'}
      </Button>
      <form onSubmit={handleSubmit(onSubmit)}>
        <FieldGroup>
          {subView === 'main' && (
            <FieldSet>
              <FieldLegend>
                {isCreate ? 'New connection method' : 'Edit connection method'}
              </FieldLegend>
              <FieldDescription>
                A method is one way an org can connect this app (e.g. an API key or OAuth). An app
                may offer more than one — the org picks at connect time.
              </FieldDescription>

              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor='method-key'>Method key</FieldLabel>
                  <Input
                    id='method-key'
                    placeholder='oauth2'
                    disabled={!isCreate}
                    aria-invalid={!!errors.methodKey}
                    {...register('methodKey')}
                  />
                  <FieldDescription>
                    A stable identifier for this method (lowercase, digits, underscores). Immutable
                    after creation.
                  </FieldDescription>
                  {errors.methodKey && (
                    <p className='text-sm text-red-600 mt-1'>{errors.methodKey.message}</p>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor='method-scope'>Scope</FieldLabel>
                  <Controller
                    name='global'
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value ? 'organization' : 'user'}
                        onValueChange={(value) => field.onChange(value === 'organization')}>
                        <SelectTrigger id='method-scope'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='organization'>Organization-wide</SelectItem>
                          <SelectItem value='user'>Per-user</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldDescription>
                    Organization-wide connections are shared by the whole org; per-user connections
                    are specific to each member.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor='method-label'>Label</FieldLabel>
                  <Input id='method-label' aria-invalid={!!errors.label} {...register('label')} />
                  {errors.label && (
                    <p className='text-sm text-red-600 mt-1'>{errors.label.message}</p>
                  )}
                </Field>
              </FieldGroup>

              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor='app-organization-auth-method'>
                    Authentication method
                  </FieldLabel>
                  <Controller
                    name='connectionType'
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value || 'none'}
                        defaultValue={field.value || 'none'}
                        onValueChange={(value) => {
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
                          <SelectItem value='client-credentials'>
                            OAuth 2.0 (Machine-to-machine)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.connectionType && (
                    <p className='text-sm text-red-600 mt-1'>{errors.connectionType.message}</p>
                  )}
                </Field>
              </FieldGroup>

              {(mintsToken || isSecret) && (
                <FieldGroup>
                  <Field>
                    <FieldLabel className='flex items-center gap-1'>
                      Dynamic Variables
                      <TooltipExplanation
                        text={
                          mintsToken
                            ? 'Define variables that organizations must provide when connecting. Use {variable_name} placeholders in the Token URL, Client ID, or Client Secret fields below (oauth2-code also supports the Authorize URL).'
                            : 'Define the fields organizations fill in when connecting (e.g. client ID, client secret, account number). Secret-flagged fields are masked and stored encrypted.'
                        }
                        side='right'
                      />
                    </FieldLabel>
                    <div className='flex items-center gap-2'>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={() => setVariableDialogOpen(true)}>
                        <Settings2 />
                        Define Variables
                      </Button>
                      {connectionVariables.length > 0 && (
                        <>
                          <Separator orientation='vertical' className='h-5' />
                          <div className='flex flex-wrap items-center gap-1'>
                            {connectionVariables.map((v) => (
                              <Badge key={v.key} variant='zinc' size='sm'>
                                {mintsToken ? `{${v.key}}` : v.key}
                              </Badge>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    {mintsToken && (
                      <FieldDescription>
                        Use these as placeholders in the fields below (e.g.{' '}
                        <code className='text-xs'>
                          {'https://{shop}.myshopify.com/admin/oauth/authorize'}
                        </code>
                        )
                      </FieldDescription>
                    )}
                    {isSecret && (
                      <FieldDescription>
                        When defined, the connect dialog shows one input per variable instead of the
                        single API-key field. Apps read the values via{' '}
                        <code className='text-xs'>connection.fields</code>.
                      </FieldDescription>
                    )}
                  </Field>

                  {mintsToken && detectedPlaceholders.length > 0 && (
                    <div className='flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800'>
                      <AlertTriangle className='size-4 shrink-0' />
                      <span>
                        Unmatched placeholders detected:{' '}
                        {detectedPlaceholders.map((p, i) => (
                          <span key={p}>
                            {i > 0 && ', '}
                            <code className='font-mono'>{`{${p}}`}</code>
                          </span>
                        ))}
                        . Define these as variables above.
                      </span>
                    </div>
                  )}
                </FieldGroup>
              )}

              {(mintsToken || isSecret) && (
                <div
                  role='button'
                  tabIndex={0}
                  onClick={() => setSubView('auth')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSubView('auth')
                    }
                  }}
                  className='flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-left hover:bg-muted/50'>
                  <div className='flex flex-col gap-1 min-w-0'>
                    <span className='font-medium'>Request authentication & base URL</span>
                    <span className='text-xs text-muted-foreground'>
                      How the credential is attached to outgoing API requests, and the base URL the
                      connection contributes.
                    </span>
                  </div>
                  <ChevronRight className='ml-auto text-muted-foreground' />
                </div>
              )}

              {mintsToken && (
                <FieldGroup>
                  {isOAuth2 && (
                    <Field>
                      <FieldLabel htmlFor='app-organization-authorize-url'>
                        Authorize URL
                      </FieldLabel>
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
                  )}
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
                    <InputGroup>
                      <InputGroupInput
                        id='app-organization-client-secret'
                        placeholder=''
                        type={secretVisible ? 'text' : 'password'}
                        {...secretRegister}
                        onBlur={(e) => {
                          // Re-mask after a reveal unless the user edited the value.
                          if (revealedSecret.current && e.target.value === revealedSecret.current) {
                            setValue('oauth2ClientSecret', maskedSecretPrefill.current)
                            revealedSecret.current = null
                            setSecretVisible(false)
                          }
                          return secretRegister.onBlur(e)
                        }}
                      />
                      <InputGroupAddon align='inline-end'>
                        {canReveal && methodId && (
                          <InputGroupButton
                            onClick={() =>
                              revealClientSecret.mutate({ connectionDefinitionId: methodId })
                            }
                            disabled={revealClientSecret.isPending}>
                            {revealClientSecret.isPending ? 'Revealing...' : 'Reveal'}
                          </InputGroupButton>
                        )}
                        <InputGroupButton
                          className='mr-1'
                          aria-label={secretVisible ? 'Hide secret' : 'Show secret'}
                          aria-pressed={secretVisible}
                          size='icon-xs'
                          onClick={() => setSecretVisible((v) => !v)}>
                          {secretVisible ? <EyeOff /> : <Eye />}
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
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
                    <FieldLabel htmlFor='app-organization-optional-scopes'>
                      Optional scopes
                    </FieldLabel>
                    <Input
                      id='app-organization-optional-scopes'
                      placeholder='read_all_orders'
                      {...register('oauth2OptionalScopes')}
                    />
                    <FieldDescription>
                      Comma-separated scopes an organization may additionally request when
                      connecting. They are not requested by default, and must not repeat a required
                      scope.
                    </FieldDescription>
                    {errors.oauth2OptionalScopes && (
                      <p className='text-sm text-red-600 mt-1'>
                        {errors.oauth2OptionalScopes.message}
                      </p>
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
                  {isOAuth2 && (
                    <FieldSet>
                      <div className='flex items-center gap-3'>
                        <Switch
                          id='app-organization-advanced'
                          checked={showAdvanced}
                          onCheckedChange={setShowAdvanced}
                        />
                        <FieldLabel htmlFor='app-organization-advanced'>
                          Advanced settings
                        </FieldLabel>
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
                              <FieldLabel htmlFor='app-organization-pkce'>
                                Use PKCE (S256)
                              </FieldLabel>
                            </div>
                            <FieldDescription>
                              Enable Proof Key for Code Exchange (RFC 7636). Required by Airtable,
                              Zoom, Twitter/X, Linear, Figma, and other providers.
                            </FieldDescription>
                          </Field>
                          <Field>
                            <div className='flex items-center gap-3'>
                              <Controller
                                name='oauth2AllowOwnClient'
                                control={control}
                                render={({ field }) => (
                                  <Switch
                                    id='app-organization-allow-own-client'
                                    checked={field.value ?? false}
                                    onCheckedChange={field.onChange}
                                  />
                                )}
                              />
                              <FieldLabel htmlFor='app-organization-allow-own-client'>
                                Let organizations use their own OAuth client
                              </FieldLabel>
                            </div>
                            <FieldDescription>
                              Turn on while the platform OAuth client is pending provider
                              verification. Organizations can then connect with the platform client
                              (they may see an unverified-app warning) or paste their own Client ID
                              and Secret in the connect dialog's advanced section.
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
                            <FieldLabel htmlFor='app-organization-refresh-url'>
                              Refresh URL
                            </FieldLabel>
                            <Input
                              id='app-organization-refresh-url'
                              placeholder='https://auth-server.com/oauth/refresh'
                              {...register('oauth2RefreshUrl')}
                            />
                            <FieldDescription>
                              Endpoint used to refresh the access token. Defaults to the Access
                              token URL when empty. Supports {'{variable}'} placeholders.
                            </FieldDescription>
                            {errors.oauth2RefreshUrl && (
                              <p className='text-sm text-red-600 mt-1'>
                                {errors.oauth2RefreshUrl.message}
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
                              JSON object of extra params appended to the token exchange request
                              body.
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
                  )}
                </FieldGroup>
              )}
            </FieldSet>
          )}

          {subView === 'auth' && (
            <FieldSet>
              <FieldLegend>Request authentication & base URL</FieldLegend>
              <FieldDescription>
                How the resolved credential is attached to outgoing API requests, and the base URL
                the connection contributes. Applies to API-key and OAuth2 methods.
              </FieldDescription>

              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor='auth-apply-mode' className='flex items-center gap-1'>
                    Credential application
                    <TooltipExplanation
                      text='How the resolved credential is attached to outgoing API requests. Bearer is correct for OAuth2 and most API keys; override for x-api-key headers, query-param keys, or HTTP Basic.'
                      side='right'
                    />
                  </FieldLabel>
                  <Controller
                    name='authApplyMode'
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value || 'none'} onValueChange={field.onChange}>
                        <SelectTrigger id='auth-apply-mode'>
                          <SelectValue placeholder='Select...' />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='none'>No auth applied</SelectItem>
                          <SelectItem value='bearer'>Bearer token</SelectItem>
                          <SelectItem value='header'>Custom header</SelectItem>
                          <SelectItem value='query'>Query parameter</SelectItem>
                          <SelectItem value='basic'>HTTP Basic</SelectItem>
                          {authApplyMode === 'advanced' && (
                            <SelectItem value='advanced'>
                              Advanced (configured externally)
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldDescription>
                    Use <code className='text-xs'>{'{value}'}</code> for the resolved token/secret
                    and <code className='text-xs'>{'{variable}'}</code> for a connection variable.
                  </FieldDescription>
                </Field>

                {authApplyMode === 'advanced' && (
                  <FieldDescription>
                    This method uses a multi-insertion auth spec set via app transfer. It can't be
                    edited here and is preserved on save.
                  </FieldDescription>
                )}

                {authApplyMode === 'header' && (
                  <div className='grid grid-cols-2 gap-4'>
                    <Field>
                      <FieldLabel htmlFor='auth-header-name'>Header name</FieldLabel>
                      <Input
                        id='auth-header-name'
                        placeholder='Authorization'
                        {...register('authHeaderName')}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor='auth-header-format' className='flex items-center gap-1'>
                        Header value
                        <TooltipExplanation
                          text='e.g. "Bearer {value}", or just "{value}" for an x-api-key header.'
                          side='right'
                        />
                      </FieldLabel>
                      <Input
                        id='auth-header-format'
                        placeholder='Bearer {value}'
                        {...register('authHeaderFormat')}
                      />
                    </Field>
                  </div>
                )}

                {authApplyMode === 'query' && (
                  <div className='grid grid-cols-2 gap-4'>
                    <Field>
                      <FieldLabel htmlFor='auth-query-name'>Query parameter name</FieldLabel>
                      <Input
                        id='auth-query-name'
                        placeholder='api_key'
                        {...register('authQueryName')}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor='auth-query-format'>Query value</FieldLabel>
                      <Input
                        id='auth-query-format'
                        placeholder='{value}'
                        {...register('authQueryFormat')}
                      />
                    </Field>
                  </div>
                )}

                {authApplyMode === 'basic' && (
                  <div className='grid grid-cols-2 gap-4'>
                    <Field>
                      <FieldLabel htmlFor='auth-basic-user' className='flex items-center gap-1'>
                        Username field
                        <TooltipExplanation
                          text='Connection-variable key holding the Basic-auth username (default "user").'
                          side='right'
                        />
                      </FieldLabel>
                      <Input
                        id='auth-basic-user'
                        placeholder='user'
                        {...register('authBasicUserField')}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor='auth-basic-password' className='flex items-center gap-1'>
                        Password field
                        <TooltipExplanation
                          text='Connection-variable key holding the Basic-auth password (default "password").'
                          side='right'
                        />
                      </FieldLabel>
                      <Input
                        id='auth-basic-password'
                        placeholder='password'
                        {...register('authBasicPasswordField')}
                      />
                    </Field>
                  </div>
                )}

                <Field>
                  <FieldLabel htmlFor='base-url-template' className='flex items-center gap-1'>
                    Base URL template
                    <TooltipExplanation
                      text='Optional. The request origin the connection contributes, interpolated from {value} + connection variables at runtime. Leave empty for APIs with a fixed base URL.'
                      side='right'
                    />
                  </FieldLabel>
                  <Input
                    id='base-url-template'
                    placeholder='https://{shop}.myshopify.com'
                    {...register('baseUrlTemplate')}
                  />
                  <FieldDescription>
                    Prepended to relative request paths. e.g.{' '}
                    <code className='text-xs'>https://api.telegram.org/bot{'{value}'}</code>.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </FieldSet>
          )}

          <Field orientation='horizontal'>
            <Button
              type='submit'
              size='sm'
              loading={isSaving}
              loadingText='Saving...'
              disabled={(!isDirty && !variablesDirty && !isCreate) || isSaving}>
              {isCreate ? 'Create method' : 'Save method'}
            </Button>
          </Field>
        </FieldGroup>
      </form>

      <ConnectionVariableDialog
        open={variableDialogOpen}
        onOpenChange={setVariableDialogOpen}
        variables={connectionVariables}
        onChange={handleVariablesChange}
      />
    </div>
  )
}

/** Connections page — a list of methods, each editable; >1 method makes the connect picker appear. */
export default function ConnectionsPage() {
  const { app_slug } = useParams<{ app_slug: string }>()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  // undefined = list view; null = creating; string = editing that method id.
  const [editing, setEditing] = useState<string | null | undefined>(undefined)

  const { data: app, isLoading: isLoadingApp } = api.apps.get.useQuery({ slug: app_slug })
  const { data: methods, isLoading: isLoadingMethods } = api.connections.list.useQuery(
    { appId: app?.id ?? '' },
    { enabled: !!app?.id }
  )

  const deleteMethod = api.connections.delete.useMutation({
    onSuccess: () => utils.connections.list.invalidate({ appId: app?.id ?? '' }),
    onError: (error) =>
      toastError({ title: 'Failed to delete method', description: error.message }),
  })

  const handleDelete = async (id: string, label: string) => {
    const confirmed = await confirm({
      title: 'Delete connection method?',
      description: `"${label}" will be removed. This can't be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deleteMethod.mutate({ connectionDefinitionId: id })
  }

  if (isLoadingApp || isLoadingMethods) {
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
      {editing !== undefined ? (
        <MethodEditor appId={app.id} methodId={editing} onClose={() => setEditing(undefined)} />
      ) : (
        <div className='max-w-3xl w-full mx-auto'>
          <FieldGroup>
            <FieldSet>
              <FieldLegend>Connections</FieldLegend>
              <FieldDescription>
                Configure how this auxx.ai app connects to your product. An app can offer more than
                one connection method (e.g. an API key or OAuth) — the org picks one at connect
                time. Auxx.ai manages the connection and exposes it to your app via the App SDK.
              </FieldDescription>
            </FieldSet>

            {(methods ?? []).length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No connection methods</EmptyTitle>
                  <EmptyDescription>
                    Add a method to let organizations connect this app.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className='flex flex-col gap-2'>
                {(methods ?? []).map((m) => (
                  // Clickable row (not a <button>) so the delete control can nest without
                  // producing invalid button-in-button markup.
                  <div
                    key={m.id}
                    role='button'
                    tabIndex={0}
                    onClick={() => setEditing(m.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setEditing(m.id)
                      }
                    }}
                    className='flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-left hover:bg-muted/50'>
                    <div className='flex flex-col gap-1 min-w-0'>
                      <div className='flex items-center gap-2'>
                        <span className='font-medium truncate'>{m.label}</span>
                        <Badge variant='zinc' size='sm'>
                          {TYPE_LABELS[m.connectionType] ?? m.connectionType}
                        </Badge>
                        <Badge variant='outline' size='sm'>
                          {m.global ? 'Organization' : 'Per-user'}
                        </Badge>
                      </div>
                      {m.key && <code className='text-xs text-muted-foreground'>{m.key}</code>}
                    </div>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      className='ml-auto text-destructive hover:text-destructive'
                      aria-label='Delete method'
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(m.id, m.label)
                      }}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Field orientation='horizontal'>
              <Button type='button' variant='outline' size='sm' onClick={() => setEditing(null)}>
                <Plus />
                Add connection method
              </Button>
            </Field>
          </FieldGroup>
        </div>
      )}
      <ConfirmDialog />
    </div>
  )
}
