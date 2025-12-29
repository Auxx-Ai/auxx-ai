// apps/build/src/app/(portal)/[slug]/apps/[app_slug]/oauth/page.tsx

'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Plus,
  Trash2,
  Check,
  RotateCw,
  Loader2,
  X,
} from 'lucide-react'
import { useForm, useFieldArray } from 'react-hook-form'
import { api } from '~/trpc/react'
import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import {
  Field,
  FieldContent,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { toastError } from '~/components/global/toast'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { useConfirm } from '~/hooks/use-confirm'

/**
 * Form data for enabling OAuth
 */
type EnableOAuthFormData = {
  externalEntrypointUrl: string
  redirectUris: { value: string }[]
}

/**
 * Enable OAuth Dialog Component
 */
function EnableOAuthDialog({
  open,
  onOpenChange,
  appSlug,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  appSlug: string
  onSuccess: () => void
}) {
  const enableOAuth = api.apps.enableOAuth.useMutation({
    onSuccess: () => {
      onOpenChange(false)
      onSuccess()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to enable OAuth',
        description: error.message,
      })
    },
  })

  const form = useForm<EnableOAuthFormData>({
    defaultValues: {
      externalEntrypointUrl: '',
      redirectUris: [{ value: '' }],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'redirectUris',
  })

  /**
   * Handle form submission
   */
  const onSubmit = form.handleSubmit((data) => {
    const redirectUris = data.redirectUris.map((r) => r.value).filter((v) => v.trim() !== '')

    if (redirectUris.length === 0) {
      toastError({
        title: 'Validation error',
        description: 'At least one redirect URI is required',
      })
      return
    }

    if (!data.externalEntrypointUrl.trim()) {
      toastError({
        title: 'Validation error',
        description: 'Install URL is required',
      })
      return
    }

    enableOAuth.mutate({
      slug: appSlug,
      redirectUris,
      externalEntrypointUrl: data.externalEntrypointUrl,
    })
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" position="tc">
        <DialogHeader>
          <DialogTitle>Enable OAuth</DialogTitle>
          <DialogDescription>
            Configure OAuth settings for your app. Users will be redirected to your install URL when
            they click &quot;Install&quot; in the Auxx.ai App Store.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit}>
          <FieldGroup>
            {/* Install URL */}
            <Field>
              <FieldLabel htmlFor="install-url">Install URL</FieldLabel>
              <Input
                id="install-url"
                placeholder="https://yourapp.com/integrations/auxx"
                {...form.register('externalEntrypointUrl')}
              />
              <FieldDescription>
                Users are redirected here when they click &quot;Install&quot;. This should be your
                product&apos;s integration page where you initiate the OAuth flow.
              </FieldDescription>
            </Field>

            {/* Redirect URIs */}
            <Field>
              <FieldLabel>Redirect URIs</FieldLabel>
              <div className="space-y-2">
                {fields.map((field, index) => (
                  <InputGroup key={field.id}>
                    <InputGroupInput
                      placeholder="https://yourapp.com/oauth/callback"
                      {...form.register(`redirectUris.${index}.value`)}
                    />
                    {fields.length > 1 && (
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          type="button"
                          aria-label="Remove redirect URI"
                          title="Remove"
                          size="icon-xs"
                          onClick={() => remove(index)}>
                          <Trash2 />
                        </InputGroupButton>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => append({ value: '' })}>
                <Plus />
                Add Redirect URI
              </Button>
              <FieldDescription>
                Valid callback URLs where users are redirected after authorization. At least one is
                required.
              </FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={enableOAuth.isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              type="submit"
              loading={enableOAuth.isPending}
              loadingText="Enabling...">
              Enable OAuth
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Edit Install URL Dialog Component
 */
function EditInstallUrlDialog({
  open,
  onOpenChange,
  appSlug,
  currentInstallUrl,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  appSlug: string
  currentInstallUrl: string
  onSuccess: () => void
}) {
  const updateInstallUrl = api.apps.updateOAuthInstallUrl.useMutation({
    onSuccess: () => {
      onOpenChange(false)
      onSuccess()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update install URL',
        description: error.message,
      })
    },
  })

  const form = useForm<{ installUrl: string }>({
    defaultValues: {
      installUrl: currentInstallUrl,
    },
  })

  /**
   * Handle form submission
   */
  const onSubmit = form.handleSubmit((data) => {
    if (!data.installUrl.trim()) {
      toastError({
        title: 'Validation error',
        description: 'Install URL is required',
      })
      return
    }

    updateInstallUrl.mutate({
      slug: appSlug,
      installUrl: data.installUrl,
    })
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" position="tc">
        <DialogHeader>
          <DialogTitle>Edit Install URL</DialogTitle>
          <DialogDescription>
            Update the URL where users are redirected when they click &quot;Install&quot; in the
            Auxx.ai App Store.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="install-url-input">Install URL</FieldLabel>
              <Input
                id="install-url-input"
                placeholder="https://yourapp.com/integrations/auxx"
                {...form.register('installUrl')}
              />
              <FieldDescription>
                This should be your product&apos;s integration page where you initiate the OAuth
                flow.
              </FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={updateInstallUrl.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              loading={updateInstallUrl.isPending}
              loadingText="Saving...">
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Edit Redirect URIs Dialog Component
 */
function EditRedirectUrisDialog({
  open,
  onOpenChange,
  appSlug,
  currentRedirectUris,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  appSlug: string
  currentRedirectUris: string[]
  onSuccess: () => void
}) {
  const updateRedirectUris = api.apps.updateOAuthRedirectUris.useMutation({
    onSuccess: () => {
      onOpenChange(false)
      onSuccess()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update redirect URIs',
        description: error.message,
      })
    },
  })

  const form = useForm<{ redirectUris: { value: string }[] }>({
    defaultValues: {
      redirectUris: currentRedirectUris.map((uri) => ({ value: uri })),
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'redirectUris',
  })

  /**
   * Handle form submission
   */
  const onSubmit = form.handleSubmit((data) => {
    const redirectUris = data.redirectUris.map((r) => r.value).filter((v) => v.trim() !== '')

    if (redirectUris.length === 0) {
      toastError({
        title: 'Validation error',
        description: 'At least one redirect URI is required',
      })
      return
    }

    updateRedirectUris.mutate({
      slug: appSlug,
      redirectUris,
    })
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" position="tc">
        <DialogHeader>
          <DialogTitle>Edit Redirect URIs</DialogTitle>
          <DialogDescription>
            Update the valid callback URLs where users are redirected after authorization.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel>Redirect URIs</FieldLabel>
              <div className="space-y-2">
                {fields.map((field, index) => (
                  <InputGroup key={field.id}>
                    <InputGroupInput
                      placeholder="https://yourapp.com/oauth/callback"
                      {...form.register(`redirectUris.${index}.value`)}
                    />
                    {fields.length > 1 && (
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          type="button"
                          aria-label="Remove redirect URI"
                          title="Remove"
                          size="icon-xs"
                          onClick={() => remove(index)}>
                          <Trash2 />
                        </InputGroupButton>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ value: '' })}>
                <Plus />
                Add Redirect URI
              </Button>
              <FieldDescription>
                At least one redirect URI is required. Make sure these match the URLs configured in
                your application.
              </FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={updateRedirectUris.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              loading={updateRedirectUris.isPending}
              loadingText="Saving...">
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * OAuth credentials page for apps
 */
export default function OAuthPage() {
  const { app_slug } = useParams<{ app_slug: string }>()
  const [showSecret, setShowSecret] = useState(false)
  const [showEnableDialog, setShowEnableDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showEditInstallUrlDialog, setShowEditInstallUrlDialog] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [justRefreshedSecret, setJustRefreshedSecret] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

  const { data, isLoading, refetch } = api.apps.getOAuthCredentials.useQuery({
    slug: app_slug,
  })

  const regenerateClientSecret = api.apps.regenerateOAuthClientSecret.useMutation({
    onSuccess: () => {
      setShowSecret(true) // Auto-show the new secret
      setJustRefreshedSecret(true)
      setTimeout(() => setJustRefreshedSecret(false), 2000)
      refetch()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to regenerate client secret',
        description: error.message,
      })
    },
  })

  const disableOAuth = api.apps.disableOAuth.useMutation({
    onSuccess: () => {
      refetch()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to disable OAuth',
        description: error.message,
      })
    },
  })

  /**
   * Handle regenerating client secret
   */
  const handleRegenerateSecret = () => {
    regenerateClientSecret.mutate({ slug: app_slug })
  }

  /**
   * Handle OAuth toggle
   */
  const handleOAuthToggle = async (checked: boolean) => {
    if (checked) {
      // Enable OAuth - open dialog
      setShowEnableDialog(true)
    } else {
      // Disable OAuth - show confirmation dialog
      const confirmed = await confirm({
        title: 'Disable OAuth?',
        description:
          'This will revoke all OAuth credentials and access tokens. Users will no longer be able to authenticate with your app through Auxx.ai.',
        confirmText: 'Disable',
        cancelText: 'Cancel',
        destructive: true,
      })

      if (confirmed) {
        disableOAuth.mutate({ slug: app_slug })
      }
    }
  }

  /**
   * Copy text to clipboard
   */
  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(fieldName)
      setTimeout(() => setCopiedField(null), 2000)
    } catch (error) {
      toastError({
        title: 'Failed to copy',
        description: `Could not copy to clipboard`,
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 overflow-y-auto">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Loader2 className="animate-spin" />
            </EmptyMedia>
            <EmptyTitle>Loading...</EmptyTitle>
            <EmptyDescription>Fetching OAuth configuration</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 overflow-y-auto">
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <X />
            </EmptyMedia>
            <EmptyTitle>Error</EmptyTitle>
            <EmptyDescription>Failed to load OAuth configuration</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  const isOAuthEnabled = data.hasOauth

  return (
    <div className="flex flex-col items-center justify-start gap-1 py-10 px-4 overflow-y-auto">
      <div className="max-w-3xl w-full mx-auto">
        <FieldGroup>
          <Field orientation="horizontal" className="items-center!">
            <FieldContent>
              <FieldLegend>OAuth Configuration</FieldLegend>
              <FieldDescription>
                {isOAuthEnabled
                  ? "Allow your app to be granted OAuth tokens which can be used to call the Auxx.ai public API. Use these credentials to implement OAuth 2.0 authentication from your product. All OAuth flows are powered by Better Auth's OIDC Provider."
                  : 'Enable OAuth to allow external systems to authenticate with Auxx.ai and call the public API on behalf of your app.'}
              </FieldDescription>
            </FieldContent>
            <Switch
              checked={isOAuthEnabled}
              onCheckedChange={handleOAuthToggle}
              disabled={disableOAuth.isPending}
            />
          </Field>

          <FieldSet>
            {/* Client ID */}
            <Field>
              <FieldLabel htmlFor="client-id">Client ID</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="client-id"
                  value={data.clientId || ''}
                  placeholder={!isOAuthEnabled ? 'Not configured yet' : undefined}
                  readOnly
                  disabled={!isOAuthEnabled}
                  className="font-mono"
                />
                {isOAuthEnabled && data.clientId && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      aria-label="Copy Client ID"
                      title="Copy"
                      size="icon-xs"
                      onClick={() => copyToClipboard(data.clientId!, 'clientId')}>
                      {copiedField === 'clientId' ? <Check /> : <Copy />}
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
              <FieldDescription>Public identifier for your app in OAuth requests</FieldDescription>
            </Field>

            {/* Client Secret */}
            <Field>
              <FieldLabel htmlFor="client-secret">Client Secret</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="client-secret"
                  type={showSecret ? 'text' : 'password'}
                  value={isOAuthEnabled && data.clientSecret ? data.clientSecret : ''}
                  placeholder={!isOAuthEnabled ? 'Not configured yet' : undefined}
                  readOnly
                  disabled={!isOAuthEnabled}
                  className="font-mono"
                />
                {isOAuthEnabled && data.clientSecret && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      aria-label="Toggle visibility"
                      title={showSecret ? 'Hide' : 'Show'}
                      size="icon-xs"
                      onClick={() => setShowSecret(!showSecret)}>
                      {showSecret ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                    <InputGroupButton
                      aria-label="Copy Client Secret"
                      title="Copy"
                      size="icon-xs"
                      onClick={() => copyToClipboard(data.clientSecret!, 'clientSecret')}>
                      {copiedField === 'clientSecret' ? <Check /> : <Copy />}
                    </InputGroupButton>
                    <InputGroupButton
                      aria-label="Regenerate Client Secret"
                      title="Refresh"
                      size="icon-xs"
                      onClick={handleRegenerateSecret}
                      disabled={regenerateClientSecret.isPending}>
                      {justRefreshedSecret ? <Check /> : <RotateCw />}
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
              <FieldDescription>
                Private secret used to exchange authorization codes for access tokens. Keep this
                secure!
              </FieldDescription>
            </Field>

            {/* Install URL */}
            <Field>
              <FieldLabel htmlFor="install-url">Install URL</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="install-url"
                  value={isOAuthEnabled && data.installUrl ? data.installUrl : ''}
                  placeholder={
                    !isOAuthEnabled ? 'https://yourapp.com/integrations/auxx' : undefined
                  }
                  readOnly
                  disabled={!isOAuthEnabled}
                  className="font-mono"
                />
                {isOAuthEnabled && data.installUrl && (
                  <InputGroupAddon align="inline-end">
                    <Link href={data.installUrl} target="_blank" rel="noopener noreferrer">
                      <InputGroupButton aria-label="Open in new tab" title="Open" size="icon-xs">
                        <ExternalLink />
                      </InputGroupButton>
                    </Link>
                    <InputGroupButton
                      aria-label="Copy Install URL"
                      title="Copy"
                      size="icon-xs"
                      onClick={() => copyToClipboard(data.installUrl!, 'installUrl')}>
                      {copiedField === 'installUrl' ? <Check /> : <Copy />}
                    </InputGroupButton>
                    <InputGroupButton
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => setShowEditInstallUrlDialog(true)}>
                      Edit
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
              <FieldDescription>
                Users are redirected here when they click &quot;Install&quot; in the Auxx.ai App
                Store. This should be your product&apos;s integration page.
              </FieldDescription>
            </Field>

            {/* Redirect URIs */}
            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>Redirect URIs</FieldLabel>
              </div>
              <div className="space-y-2">
                {isOAuthEnabled && data.redirectUris.length > 0 ? (
                  data.redirectUris.map((uri, index) => (
                    <InputGroup key={index}>
                      <InputGroupInput value={uri} readOnly className="font-mono" />
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          aria-label="Copy Redirect URI"
                          title="Copy"
                          size="icon-xs"
                          onClick={() => copyToClipboard(uri, `redirectUri-${index}`)}>
                          {copiedField === `redirectUri-${index}` ? <Check /> : <Copy />}
                        </InputGroupButton>
                        <InputGroupButton
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => setShowEditDialog(true)}>
                          Edit
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                  ))
                ) : (
                  <InputGroup>
                    <InputGroupInput
                      placeholder="https://yourapp.com/oauth/callback"
                      readOnly
                      disabled
                      className="font-mono"
                    />
                  </InputGroup>
                )}
              </div>
              <FieldDescription>
                Valid callback URLs where users are redirected after authorization
              </FieldDescription>
            </Field>

            {/* Scopes */}
            {isOAuthEnabled && data.scopes.length > 0 && (
              <Field>
                <FieldLabel>Scopes</FieldLabel>
                <div className="text-sm text-muted-foreground font-mono">
                  {data.scopes.join(', ')}
                </div>
                <FieldDescription>
                  Permissions your app can request during the OAuth flow
                </FieldDescription>
              </Field>
            )}
          </FieldSet>

          {/* OAuth Endpoints */}
          <FieldSet>
            <FieldLegend>OAuth 2.0 Endpoints</FieldLegend>
            <FieldDescription>
              {isOAuthEnabled
                ? 'Use these Auxx.ai endpoints for your OAuth implementation'
                : 'These endpoints will be available after enabling OAuth'}
            </FieldDescription>

            <Field>
              <FieldLabel htmlFor="auth-endpoint">Authorization Endpoint</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="auth-endpoint"
                  value={
                    isOAuthEnabled && data.authorizationEndpoint ? data.authorizationEndpoint : ''
                  }
                  placeholder={!isOAuthEnabled ? 'Not configured yet' : undefined}
                  readOnly
                  disabled={!isOAuthEnabled}
                  className="font-mono text-xs"
                />
                {isOAuthEnabled && data.authorizationEndpoint && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      aria-label="Copy Authorization Endpoint"
                      title="Copy"
                      size="icon-xs"
                      onClick={() => copyToClipboard(data.authorizationEndpoint!, 'authEndpoint')}>
                      {copiedField === 'authEndpoint' ? <Check /> : <Copy />}
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </Field>

            <Field>
              <FieldLabel htmlFor="token-endpoint">Token Endpoint</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="token-endpoint"
                  value={isOAuthEnabled && data.tokenEndpoint ? data.tokenEndpoint : ''}
                  placeholder={!isOAuthEnabled ? 'Not configured yet' : undefined}
                  readOnly
                  disabled={!isOAuthEnabled}
                  className="font-mono text-xs"
                />
                {isOAuthEnabled && data.tokenEndpoint && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      aria-label="Copy Token Endpoint"
                      title="Copy"
                      size="icon-xs"
                      onClick={() => copyToClipboard(data.tokenEndpoint!, 'tokenEndpoint')}>
                      {copiedField === 'tokenEndpoint' ? <Check /> : <Copy />}
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </Field>

            <Field>
              <FieldLabel htmlFor="userinfo-endpoint">UserInfo Endpoint</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="userinfo-endpoint"
                  value={isOAuthEnabled && data.userInfoEndpoint ? data.userInfoEndpoint : ''}
                  placeholder={!isOAuthEnabled ? 'Not configured yet' : undefined}
                  readOnly
                  disabled={!isOAuthEnabled}
                  className="font-mono text-xs"
                />
                {isOAuthEnabled && data.userInfoEndpoint && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      aria-label="Copy UserInfo Endpoint"
                      title="Copy"
                      size="icon-xs"
                      onClick={() => copyToClipboard(data.userInfoEndpoint!, 'userInfoEndpoint')}>
                      {copiedField === 'userInfoEndpoint' ? <Check /> : <Copy />}
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </Field>
          </FieldSet>
        </FieldGroup>
      </div>

      <ConfirmDialog />

      <EnableOAuthDialog
        open={showEnableDialog}
        onOpenChange={setShowEnableDialog}
        appSlug={app_slug}
        onSuccess={refetch}
      />

      <EditInstallUrlDialog
        open={showEditInstallUrlDialog}
        onOpenChange={setShowEditInstallUrlDialog}
        appSlug={app_slug}
        currentInstallUrl={data.installUrl || ''}
        onSuccess={refetch}
      />

      <EditRedirectUrisDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        appSlug={app_slug}
        currentRedirectUris={data.redirectUris}
        onSuccess={refetch}
      />
    </div>
  )
}
