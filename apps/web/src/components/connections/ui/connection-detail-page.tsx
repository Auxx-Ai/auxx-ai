// apps/web/src/components/connections/ui/connection-detail-page.tsx
'use client'

import type { ConnectionVariable } from '@auxx/database'
import { Button } from '@auxx/ui/components/button'
import { Field, FieldError, FieldLabel } from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight, KeyRound, Plug } from 'lucide-react'
import { ConnectionVariableFields } from '~/components/connections/ui/connection-variable-fields'
import { FieldPanel } from '~/components/global/forms/field-panel'

/** One connect method an item exposes (the detail page renders + collects input for it). */
export interface DetailMethod {
  id: string
  label: string
  description: string | null
  connectionType: string
  /** true = organization-wide, false = user-specific. Shown as a scope hint. */
  global: boolean
  connectionVariables?: ConnectionVariable[] | null
  /** OAuth approval gate (§3.1): this connection must bring its own client id/secret. */
  requiresOwnClient?: boolean
  /** Platform client works but is pending verification — BYO offered as an optional alternative. */
  ownClientOptional?: boolean
  ownClientReason?: 'no-platform-client' | 'pending-approval' | null
}

/** Copy for the mandatory BYO-client banner (§3.1) — shown only when `requiresOwnClient`. */
const OWN_CLIENT_COPY: Record<NonNullable<DetailMethod['ownClientReason']>, string> = {
  'pending-approval':
    'Our platform app for this provider is pending verification — connect with your own OAuth app for now.',
  'no-platform-client':
    'No platform OAuth app is configured for this provider — connect with your own OAuth app.',
}

interface ConnectionDetailPageProps {
  /** Every method the item exposes. >1 renders the method chooser. */
  methods: DetailMethod[]
  /** Chosen method id (null until picked); the sole method auto-resolves. */
  selectedMethodId: string | null
  onMethodChange: (id: string) => void
  values: Record<string, string>
  onValueChange: (key: string, value: string) => void
  token: string
  onTokenChange: (token: string) => void
  errors: Record<string, string>
  disabled?: boolean
  /** Render the editable connection-name row (top of the form). */
  showName?: boolean
  /** Current name value (controlled). Only read when `showName`. */
  name?: string
  onNameChange?: (value: string) => void
  /** Validation message for the name field. */
  nameError?: string
  /** Editing: secret keys with a stored value, so their fields offer a revert-to-keep button. */
  savedSecrets?: Set<string>
  /** Editing: the bare token has a stored value (enables its revert button). */
  tokenSaved?: boolean
  /**
   * BYO disclosure state for an `ownClientOptional` method (§3.1): the parent reshapes the
   * method via {@link applyOwnClientDisclosure} and owns this state; the page renders the
   * "Use your own OAuth client (advanced)" toggle. Omit to render the client fields inline.
   */
  byoOpen?: boolean
  onByoOpenChange?: (open: boolean) => void
  /** Override the root padding/layout (e.g. the dialog drops the gallery's `px-4 py-5`). */
  className?: string
}

/** Short type label shown in parentheses next to the method name. */
const TYPE_LABEL: Record<string, string> = {
  'oauth2-code': 'OAuth',
  'client-credentials': 'OAuth (M2M)',
  secret: 'API key',
}

/** A secret/variable method needs the field step; bare OAuth connects one-click. */
export function methodNeedsFields(method: DetailMethod): boolean {
  return method.connectionType === 'secret' || (method.connectionVariables?.length ?? 0) > 0
}

/** The BYO OAuth-client variable keys (client-side mirror of the server gate's set). */
const BYO_CLIENT_KEYS = new Set(['clientId', 'clientSecret'])

/** The platform client works and BYO is offered only as an opt-in alternative (§3.1). */
export function methodOffersOwnClient(method: DetailMethod): boolean {
  return (
    method.connectionType === 'oauth2-code' &&
    !!method.ownClientOptional &&
    !method.requiresOwnClient
  )
}

/**
 * Apply the BYO-client disclosure to an `ownClientOptional` method: closed → the optional
 * client fields are dropped so the platform login connects one-click; open → they render and
 * become required (a half-filled client pair must never reach the OAuth kickoff). Mandatory
 * (`requiresOwnClient`) and non-OAuth methods pass through untouched.
 */
export function applyOwnClientDisclosure<M extends DetailMethod>(method: M, byoOpen: boolean): M {
  if (!methodOffersOwnClient(method)) return method
  const vars = method.connectionVariables ?? []
  return {
    ...method,
    connectionVariables: byoOpen
      ? vars.map((v) => (BYO_CLIENT_KEYS.has(v.key) ? { ...v, required: true } : v))
      : vars.filter((v) => !BYO_CLIENT_KEYS.has(v.key)),
  }
}

/** A single-secret method (API key) with no structured variables. */
export function methodIsBareSecret(method: DetailMethod): boolean {
  return method.connectionType === 'secret' && (method.connectionVariables?.length ?? 0) === 0
}

/**
 * The connect form shown on the gallery's detail page. Owns both the method chooser (when an
 * item exposes more than one way to connect — e.g. Stripe: API key OR OAuth2) and the input
 * fields for the chosen method (an API key and/or structured connection variables). A bare
 * OAuth method renders neither and connects one-click. See
 * plans/connections/unify-connection-definition.md §15 and multi-connection-per-app.md §3.
 */
export function ConnectionDetailPage({
  methods,
  selectedMethodId,
  onMethodChange,
  values,
  onValueChange,
  token,
  onTokenChange,
  errors,
  disabled,
  savedSecrets,
  tokenSaved,
  byoOpen,
  onByoOpenChange,
  className,
  showName,
  name = '',
  onNameChange,
  nameError,
}: ConnectionDetailPageProps) {
  // The sole method auto-resolves; >1 requires an explicit pick.
  const chosen =
    methods.find((m) => m.id === selectedMethodId) ?? (methods.length === 1 ? methods[0] : null)

  return (
    <div className={cn('flex flex-col gap-4 px-4 py-5', className)}>
      {showName && (
        <Field>
          <FieldLabel>Name</FieldLabel>
          <Input
            placeholder='Connection name'
            value={name}
            onChange={(e) => onNameChange?.(e.target.value)}
            disabled={disabled}
            autoComplete='off'
          />
          {nameError && <FieldError>{nameError}</FieldError>}
        </Field>
      )}
      {methods.length > 1 && (
        <div className='flex flex-col gap-2'>
          <div className='text-xs font-medium text-muted-foreground'>Connection method</div>
          <RadioGroup
            value={selectedMethodId ?? undefined}
            onValueChange={onMethodChange}
            disabled={disabled}
            className='gap-2'>
            {methods.map((method) => (
              <RadioGroupItemCard
                key={method.id}
                value={method.id}
                icon={method.connectionType === 'oauth2-code' ? <Plug /> : <KeyRound />}
                label={method.label}
                sublabel={TYPE_LABEL[method.connectionType]}
                description={
                  method.description ??
                  (method.global ? 'Shared across your workspace.' : 'Connected to your account.')
                }
              />
            ))}
          </RadioGroup>
        </div>
      )}
      {chosen?.requiresOwnClient && chosen.ownClientReason && (
        <div className='rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400'>
          {OWN_CLIENT_COPY[chosen.ownClientReason]}
        </div>
      )}
      {chosen && methodOffersOwnClient(chosen) && (
        <div className='flex flex-col gap-2'>
          <div className='rounded-md border px-3 py-2 text-xs text-muted-foreground'>
            This app's platform OAuth client is pending provider verification — you can continue
            with it (you may see an "unverified app" warning during sign-in), or use your own OAuth
            client.
          </div>
          {onByoOpenChange && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-auto w-fit gap-1 px-1 py-0.5 text-xs text-muted-foreground'
              onClick={() => onByoOpenChange(!byoOpen)}
              disabled={disabled}>
              {byoOpen ? <ChevronDown /> : <ChevronRight />}
              Use your own OAuth client (advanced)
            </Button>
          )}
        </div>
      )}
      {chosen && methodNeedsFields(chosen) && (
        <div className='flex flex-col gap-2'>
          <div className='text-xs font-medium text-muted-foreground'>Credentials</div>
          <FieldPanel
            orientation='responsive'
            breakpoint='md'
            resizeId='connection-detail'
            defaultLabelWidth={280}
            className='p-0'>
            <ConnectionVariableFields
              variables={chosen.connectionVariables ?? []}
              values={values}
              onValueChange={onValueChange}
              showToken={methodIsBareSecret(chosen)}
              token={token}
              onTokenChange={onTokenChange}
              errors={errors}
              disabled={disabled}
              savedSecrets={savedSecrets}
              tokenSaved={tokenSaved}
            />
          </FieldPanel>
        </div>
      )}
    </div>
  )
}
