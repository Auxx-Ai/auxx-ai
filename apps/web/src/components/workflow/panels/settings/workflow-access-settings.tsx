// apps/web/src/components/workflow/panels/settings/workflow-access-settings.tsx

import { API_URL, WEBAPP_URL } from '@auxx/config/urls'
import { AutosizeTextarea } from '@auxx/ui/components/autosize-textarea'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@auxx/ui/components/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import {
  NumberInput,
  NumberInputDecrement,
  NumberInputField,
  NumberInputIncrement,
  NumberInputScrubber,
} from '@auxx/ui/components/input-number'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { Switch } from '@auxx/ui/components/switch'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import {
  Building,
  Check,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Link,
  LockKeyhole,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useWorkflowSave } from '~/components/workflow/hooks/use-workflow-save'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import Field from '../../ui/field'
import Section from '../../ui/section'

/** Access mode for web access (public or organization) */
type AccessMode = 'public' | 'organization'

/** Access mode configuration for web access */
const ACCESS_MODES = {
  public: {
    icon: Globe,
    label: 'Public',
    sublabel: 'Open Access',
    description: 'Anyone with the link can run this workflow',
  },
  organization: {
    icon: Building,
    label: 'Organization',
    sublabel: 'Members Only',
    description: 'Only members of your organization can access',
  },
} as const

interface WorkflowAccessSettingsProps {
  workflowAppId: string
  shareToken?: string | null
  /** Whether web/browser access is enabled */
  webEnabled?: boolean
  /** Whether programmatic API access is enabled */
  apiEnabled?: boolean
  /** Access mode for web access (public or organization) */
  accessMode?: AccessMode
  config?: {
    title?: string
    description?: string
    about?: string
    logoUrl?: string
    brandName?: string
    hideBranding?: boolean
    showWorkflowPreview?: boolean
    showInputForm?: boolean
    submitButtonText?: string
    successMessage?: string
    maxConcurrentRuns?: number
    showWorkflowDetails?: boolean
  }
  rateLimit?: {
    enabled: boolean
    maxRequests: number
    windowMs: number
    perUser?: boolean
  }
}

/**
 * Component for configuring workflow access settings.
 * Separates web (browser) access from API (programmatic) access.
 */
export const WorkflowAccessSettings = memo(function WorkflowAccessSettings({
  workflowAppId,
  shareToken: initialShareToken,
  webEnabled: initialWebEnabled = false,
  apiEnabled: initialApiEnabled = false,
  accessMode: initialAccessMode = 'public',
  config: initialConfig,
  rateLimit: initialRateLimit,
}: WorkflowAccessSettingsProps) {
  // Local state
  const [webEnabled, setWebEnabled] = useState(initialWebEnabled)
  const [apiEnabled, setApiEnabled] = useState(initialApiEnabled)
  const [accessMode, setAccessMode] = useState<AccessMode>(initialAccessMode)
  const [shareToken, setShareToken] = useState(initialShareToken)
  const [config, setConfig] = useState(initialConfig || {})
  const [rateLimit, setRateLimit] = useState(
    initialRateLimit || { enabled: false, maxRequests: 100, windowMs: 60000 }
  )
  // Dedicated local state for about textarea (debounced save)
  const [localAbout, setLocalAbout] = useState(initialConfig?.about ?? '')
  const { copied: copiedLink, copy: copyLink } = useCopy({
    toastMessage: 'Share link copied to clipboard',
  })
  const {
    copied: copiedKey,
    copy: copyApiKey,
    reset: resetCopiedKey,
  } = useCopy({
    toastMessage: 'API key copied to clipboard',
    autoReset: false,
  })
  const { copied: copiedEndpoint, copy: copyEndpoint } = useCopy({
    toastMessage: 'Endpoint copied to clipboard',
  })
  const [justRegenerated, setJustRegenerated] = useState(false)
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [accessModeOpen, setAccessModeOpen] = useState(false)

  // Refs to track "saved" values for change detection
  const savedRef = useRef({
    webEnabled: initialWebEnabled,
    apiEnabled: initialApiEnabled,
    accessMode: initialAccessMode,
    rateLimit: initialRateLimit || { enabled: false, maxRequests: 100, windowMs: 60000 },
  })

  // Unified save hook
  const { saveShareSettings, isSaving } = useWorkflowSave()

  /** Deep compare two objects */
  const isEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

  // Confirmation dialog
  const [confirm, ConfirmDialog] = useConfirm()

  // API utils for share token management
  const utils = api.useUtils()

  // Generate share token mutation
  const generateToken = api.workflow.generateShareToken.useMutation({
    onSuccess: (data) => {
      if (data?.shareToken) {
        setShareToken(data.shareToken)
        toastSuccess({ description: 'Share link generated' })
        utils.workflow.getById.invalidate({ id: workflowAppId })
      }
    },
    onError: (error) => {
      toastError({ title: 'Failed to generate share link', description: error.message })
    },
  })

  // Revoke share token mutation
  const revokeToken = api.workflow.revokeShareToken.useMutation({
    onSuccess: () => {
      setShareToken(null)
      setWebEnabled(false)
      setApiEnabled(false)
      toastSuccess({ description: 'Share link revoked' })
      utils.workflow.getById.invalidate({ id: workflowAppId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to revoke share link', description: error.message })
    },
  })

  // API key query - fetch when API access is enabled
  const { data: workflowApiKeys = [], refetch: refetchApiKeys } = api.apiKey.getAll.useQuery(
    { workflowAppId },
    { enabled: apiEnabled }
  )

  // Create workflow API key mutation
  const createApiKey = api.apiKey.create.useMutation({
    onSuccess: (data) => {
      setNewlyCreatedKey(data.secretKey)
      resetCopiedKey()
      refetchApiKeys()
    },
    onError: (error) => {
      toastError({ title: 'Failed to create API key', description: error.message })
    },
  })

  // Delete API key mutation
  const deleteApiKey = api.apiKey.delete.useMutation({
    onSuccess: () => {
      refetchApiKeys()
      toastSuccess({ description: 'API key revoked' })
    },
    onError: (error) => {
      toastError({ title: 'Failed to revoke API key', description: error.message })
    },
  })

  // Sync state when props change
  useEffect(() => {
    setWebEnabled(initialWebEnabled)
    setApiEnabled(initialApiEnabled)
    setAccessMode(initialAccessMode)
    setShareToken(initialShareToken)
    setConfig(initialConfig || {})
    setLocalAbout(initialConfig?.about ?? '')
    const newRateLimit = initialRateLimit || { enabled: false, maxRequests: 100, windowMs: 60000 }
    setRateLimit(newRateLimit)
    savedRef.current = {
      webEnabled: initialWebEnabled,
      apiEnabled: initialApiEnabled,
      accessMode: initialAccessMode,
      rateLimit: newRateLimit,
    }
  }, [
    initialWebEnabled,
    initialApiEnabled,
    initialAccessMode,
    initialShareToken,
    initialConfig,
    initialRateLimit,
  ])

  /** Handle web access toggle */
  const handleWebEnabledChange = useCallback(
    async (enabled: boolean) => {
      if (enabled && !shareToken) {
        await generateToken.mutateAsync({ id: workflowAppId })
      }
      setWebEnabled(enabled)
      if (enabled !== savedRef.current.webEnabled) {
        savedRef.current.webEnabled = enabled
        saveShareSettings({ webEnabled: enabled })
      }
    },
    [shareToken, workflowAppId, generateToken, saveShareSettings]
  )

  /** Handle API access toggle */
  const handleApiEnabledChange = useCallback(
    async (enabled: boolean) => {
      if (enabled && !shareToken) {
        await generateToken.mutateAsync({ id: workflowAppId })
      }
      setApiEnabled(enabled)
      if (enabled !== savedRef.current.apiEnabled) {
        savedRef.current.apiEnabled = enabled
        saveShareSettings({ apiEnabled: enabled })
      }
    },
    [shareToken, workflowAppId, generateToken, saveShareSettings]
  )

  /** Handle access mode change */
  const handleAccessModeChange = useCallback(
    (mode: AccessMode) => {
      setAccessMode(mode)
      setAccessModeOpen(false)
      if (mode !== savedRef.current.accessMode) {
        savedRef.current.accessMode = mode
        saveShareSettings({ accessMode: mode })
      }
    },
    [saveShareSettings]
  )

  /** Handle rate limit toggle */
  const handleRateLimitToggle = useCallback(
    (enabled: boolean) => {
      const newRateLimit = { ...rateLimit, enabled }
      setRateLimit(newRateLimit)
      if (!isEqual(newRateLimit, savedRef.current.rateLimit)) {
        savedRef.current.rateLimit = newRateLimit
        saveShareSettings({ rateLimit: newRateLimit })
      }
    },
    [rateLimit, saveShareSettings]
  )

  /** Handle rate limit value changes */
  const handleRateLimitChange = useCallback(
    (field: 'maxRequests' | 'windowMs' | 'perUser', value: number | boolean) => {
      const newRateLimit = { ...rateLimit, [field]: value }
      setRateLimit(newRateLimit)
      if (!isEqual(newRateLimit, savedRef.current.rateLimit)) {
        savedRef.current.rateLimit = newRateLimit
        saveShareSettings({ rateLimit: newRateLimit })
      }
    },
    [rateLimit, saveShareSettings]
  )

  /** Handle config change for config fields */
  const handleConfigChange = useCallback(
    (field: string, value: boolean | string) => {
      const newConfig = { ...config, [field]: value }
      setConfig(newConfig)
      saveShareSettings({ config: newConfig })
    },
    [config, saveShareSettings]
  )

  /** Handle about textarea change - update local state and queue debounced save */
  const handleAboutChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newAbout = e.target.value
      setLocalAbout(newAbout)
      const newConfig = { ...config, about: newAbout }
      setConfig(newConfig)
      saveShareSettings({ config: newConfig })
    },
    [config, saveShareSettings]
  )

  /** Open share link in new tab */
  const handleOpenLink = useCallback(() => {
    if (!shareToken) return
    const shareUrl = `${WEBAPP_URL}/workflows/run/${shareToken}`
    window.open(shareUrl, '_blank')
  }, [shareToken])

  /** Regenerate share token */
  const handleRegenerateToken = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Regenerate share link?',
      description:
        'This will invalidate the existing share link. Anyone with the old link will no longer be able to access this workflow.',
      confirmText: 'Regenerate',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await generateToken.mutateAsync({ id: workflowAppId })
      setJustRegenerated(true)
      setTimeout(() => setJustRegenerated(false), 2000)
    }
  }, [confirm, generateToken, workflowAppId])

  /** Revoke all access */
  const handleRevokeAccess = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Revoke all access?',
      description:
        'This will disable both web and API access, and invalidate the share link. You can re-enable access later.',
      confirmText: 'Revoke',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await revokeToken.mutateAsync({ id: workflowAppId })
    }
  }, [confirm, revokeToken, workflowAppId])

  const shareUrl = shareToken ? `${WEBAPP_URL}/workflows/run/${shareToken}` : null

  /** Create a new workflow API key */
  const handleCreateApiKey = useCallback(async () => {
    await createApiKey.mutateAsync({
      type: 'workflow',
      workflowAppId,
    })
  }, [createApiKey, workflowAppId])

  /** Revoke a workflow API key */
  const handleRevokeApiKey = useCallback(
    async (keyId: string) => {
      const confirmed = await confirm({
        title: 'Revoke API key?',
        description:
          'This will permanently disable this API key. Any applications using this key will lose access.',
        confirmText: 'Revoke',
        cancelText: 'Cancel',
        destructive: true,
      })

      if (confirmed) {
        await deleteApiKey.mutateAsync({ id: keyId })
      }
    },
    [confirm, deleteApiKey]
  )

  /** Close API key dialog - only allowed after copying */
  const handleCloseApiKeyDialog = useCallback(() => {
    if (copiedKey) {
      setNewlyCreatedKey(null)
      resetCopiedKey()
    }
  }, [copiedKey, resetCopiedKey])

  /** Prevent dialog close if not copied */
  const handlePreventClose = useCallback(
    (e: Event) => {
      if (!copiedKey) {
        e.preventDefault()
      }
    },
    [copiedKey]
  )

  // Check if any access is enabled
  const hasAnyAccess = webEnabled || apiEnabled

  return (
    <>
      <ConfirmDialog />

      {/* ═══════════════════════════════════════════════════════ */}
      {/* WEB ACCESS                                              */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Section
        title='Web Access'
        description='Allow others to run this workflow via browser'
        showEnable
        enabled={webEnabled}
        onEnableChange={handleWebEnabledChange}>
        <div className='space-y-4'>
          <div className='space-y-1'>
            <div className='flex items-center gap-2'>
              <div
                className={`size-2 rounded-full ${webEnabled ? 'bg-good-500' : 'bg-muted-foreground/50'}`}
              />
              <span className='text-sm'>
                {webEnabled ? 'Web access enabled' : 'Web access disabled'}
              </span>
            </div>
            <p className='text-xs text-muted-foreground'>
              {webEnabled
                ? 'Others can run this workflow via the share link in their browser.'
                : 'Enable web access to allow others to run this workflow via a public link.'}
            </p>
          </div>
          {shareToken && (
            <Field title='Share Link'>
              <InputGroup>
                <InputGroupAddon align='inline-start'>
                  <Link />
                </InputGroupAddon>
                <InputGroupInput
                  type='text'
                  value={shareUrl || ''}
                  readOnly
                  className='font-mono text-xs'
                  onFocus={(e) => e.target.select()}
                />
                <InputGroupAddon align='inline-end' className='gap-0.5'>
                  <Tooltip content='Copy'>
                    <InputGroupButton
                      aria-label='Copy share link'
                      className='rounded-full'
                      size='icon-xs'
                      onClick={() => shareUrl && copyLink(shareUrl)}>
                      {copiedLink ? <Check /> : <Copy />}
                    </InputGroupButton>
                  </Tooltip>
                  <Tooltip content='Open'>
                    <InputGroupButton
                      aria-label='Open share link'
                      className='rounded-full'
                      size='icon-xs'
                      onClick={handleOpenLink}>
                      <ExternalLink />
                    </InputGroupButton>
                  </Tooltip>
                  <Tooltip content='Regenerate'>
                    <InputGroupButton
                      aria-label='Regenerate share link'
                      className='rounded-full'
                      size='icon-xs'
                      onClick={handleRegenerateToken}
                      disabled={generateToken.isPending}>
                      {justRegenerated ? <Check /> : <RefreshCw />}
                    </InputGroupButton>
                  </Tooltip>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          )}
          <Field
            title='Execution Details'
            description='Control what execution information is visible to users'>
            <div className='flex items-center justify-between'>
              <div>
                <Label htmlFor='showWorkflowDetails' className='cursor-pointer'>
                  Show workflow details
                </Label>
                <p className='text-xs text-muted-foreground mt-1'>
                  When enabled, users can see all node execution events. When disabled, only the
                  final result from the End node is shown.
                </p>
              </div>
              <Switch
                id='showWorkflowDetails'
                size='sm'
                className='ml-4'
                checked={config.showWorkflowDetails ?? false}
                onCheckedChange={(checked) => handleConfigChange('showWorkflowDetails', checked)}
              />
            </div>
          </Field>

          <Collapsible className='mb-2!' open={accessModeOpen} onOpenChange={setAccessModeOpen}>
            <Field
              className=''
              title='Access Mode'
              description='Configure who can access this workflow via web'
              actions={
                <CollapsibleTrigger asChild>
                  <Button size='xs' variant='ghost'>
                    {(() => {
                      const Icon = ACCESS_MODES[accessMode].icon
                      return <Icon />
                    })()}
                    {ACCESS_MODES[accessMode].label}
                  </Button>
                </CollapsibleTrigger>
              }>
              <CollapsibleContent>
                <RadioGroup
                  value={accessMode}
                  onValueChange={(v) => handleAccessModeChange(v as AccessMode)}>
                  {(
                    Object.entries(ACCESS_MODES) as [
                      AccessMode,
                      (typeof ACCESS_MODES)[AccessMode],
                    ][]
                  ).map(([mode, modeConfig]) => {
                    const Icon = modeConfig.icon
                    return (
                      <RadioGroupItemCard
                        key={mode}
                        value={mode}
                        label={modeConfig.label}
                        sublabel={modeConfig.sublabel}
                        icon={<Icon />}
                        description={modeConfig.description}
                      />
                    )
                  })}
                </RadioGroup>
              </CollapsibleContent>
            </Field>
          </Collapsible>

          <Field
            title='About'
            wrapperClassName='-mx-1.5 mt-0'
            description='Optional text shown in the About dialog on the public page'>
            <AutosizeTextarea
              placeholder='Add information about this workflow...'
              value={localAbout}
              onChange={handleAboutChange}
              minHeight={35}
              maxHeight={300}
              className='text-sm border-0 px-2 '
            />
          </Field>
        </div>
      </Section>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* API ACCESS                                              */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Section
        title='API Access'
        description='Allow programmatic access via REST API'
        showEnable
        collapsible
        enabled={apiEnabled}
        onEnableChange={handleApiEnabledChange}>
        <div className='space-y-4'>
          <div className='space-y-1'>
            <div className='flex items-center gap-2'>
              <div
                className={`size-2 rounded-full ${apiEnabled ? 'bg-good-500' : 'bg-muted-foreground/50'}`}
              />
              <span className='text-sm'>
                {apiEnabled ? 'API access enabled' : 'API access disabled'}
              </span>
            </div>
            <p className='text-xs text-muted-foreground'>
              {apiEnabled
                ? 'Applications can run this workflow via API with a valid API key.'
                : 'Enable API access to allow programmatic execution of this workflow.'}
            </p>
          </div>
          <Field
            title='Workflow API Keys'
            description='Manage API keys for programmatic access'
            actions={
              <Button
                size='xs'
                variant='ghost'
                onClick={handleCreateApiKey}
                loading={createApiKey.isPending}
                loadingText='Creating...'>
                <LockKeyhole />
                Create New API Key
              </Button>
            }>
            {/* API endpoint info */}
            <div className='space-y-2'>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>POST</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  type='text'
                  value={`${API_URL}/api/v1/workflows/run`}
                  readOnly
                  className='font-mono text-xs'
                  onFocus={(e) => e.target.select()}
                />
                <InputGroupAddon align='inline-end'>
                  <Tooltip content='Copy'>
                    <InputGroupButton
                      aria-label='Copy endpoint'
                      className='rounded-full'
                      size='icon-xs'
                      onClick={() => copyEndpoint(`${API_URL}/api/v1/workflows/run`)}>
                      {copiedEndpoint ? <Check /> : <Copy />}
                    </InputGroupButton>
                  </Tooltip>
                </InputGroupAddon>
              </InputGroup>
            </div>
          </Field>

          {/* List existing keys */}
          {workflowApiKeys.length > 0 ? (
            <div className='space-y-2'>
              {workflowApiKeys.map((key) => (
                <InputGroup key={key.id}>
                  <InputGroupAddon align='inline-start'>
                    <KeyRound className='size-3 text-muted-foreground' />
                  </InputGroupAddon>
                  <InputGroupText className='ms-1 flex-1 truncate font-mono'>
                    {key.name}
                  </InputGroupText>
                  <InputGroupAddon align='inline-end' className='pe-2.5 gap-2'>
                    <Badge variant='gray' className='opacity-50 rounded-lg'>
                      {new Date(key.createdAt).toLocaleDateString()}
                    </Badge>
                    <InputGroupButton
                      type='button'
                      variant='destructive-hover'
                      className='rounded-lg'
                      aria-label='Revoke API key'
                      title='Revoke'
                      size='icon-xs'
                      onClick={() => handleRevokeApiKey(key.id)}
                      disabled={deleteApiKey.isPending}>
                      <Trash2 />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              ))}
            </div>
          ) : (
            <p className='text-sm text-muted-foreground'>No API keys yet.</p>
          )}
        </div>
      </Section>

      {/* API Key Created Dialog */}
      <Dialog open={!!newlyCreatedKey} onOpenChange={(open) => !open && handleCloseApiKeyDialog()}>
        <DialogContent
          size='sm'
          showClose={false}
          onEscapeKeyDown={handlePreventClose}
          onPointerDownOutside={handlePreventClose}>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              Copy this API key now. It won&apos;t be shown again.
            </DialogDescription>
          </DialogHeader>
          <InputGroup>
            <InputGroupAddon align='inline-start'>
              <KeyRound />
            </InputGroupAddon>
            <InputGroupInput
              type='text'
              value={newlyCreatedKey || ''}
              readOnly
              className='font-mono text-xs'
              onFocus={(e) => e.target.select()}
            />
            <InputGroupAddon align='inline-end'>
              <Tooltip content={copiedKey ? 'Copied!' : 'Copy'}>
                <InputGroupButton
                  aria-label='Copy API key'
                  className='rounded-full'
                  size='icon-xs'
                  onClick={() => newlyCreatedKey && copyApiKey(newlyCreatedKey)}>
                  {copiedKey ? <Check /> : <Copy />}
                </InputGroupButton>
              </Tooltip>
            </InputGroupAddon>
          </InputGroup>
          <DialogFooter>
            <Button
              onClick={handleCloseApiKeyDialog}
              size='sm'
              disabled={!copiedKey}
              variant='outline'>
              {copiedKey ? 'Done' : 'Copy to continue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rate Limiting Section - shown when any access is enabled */}
      {hasAnyAccess && (
        <Section
          title='Rate Limiting'
          description='Limit how often users can run this workflow'
          showEnable
          enabled={rateLimit.enabled}
          onEnableChange={handleRateLimitToggle}
          initialOpen={false}>
          <div className='space-y-3'>
            <div className='grid grid-cols-2 gap-3'>
              <NumberInput
                value={rateLimit.maxRequests}
                onValueChange={(val) => handleRateLimitChange('maxRequests', val ?? 1)}
                min={1}
                step={1}>
                <div className='flex flex-col items-start'>
                  <NumberInputScrubber htmlFor='maxRequests' className='mb-1'>
                    Max requests
                  </NumberInputScrubber>
                  <InputGroup>
                    <InputGroupAddon align='inline-start'>
                      <NumberInputDecrement />
                    </InputGroupAddon>
                    <NumberInputField id='maxRequests' placeholder='100' />
                    <InputGroupAddon align='inline-end'>
                      <NumberInputIncrement />
                    </InputGroupAddon>
                  </InputGroup>
                </div>
              </NumberInput>

              <NumberInput
                value={Math.round(rateLimit.windowMs / 1000)}
                onValueChange={(val) => handleRateLimitChange('windowMs', (val ?? 1) * 1000)}
                min={1}
                step={1}>
                <div className='flex flex-col items-start'>
                  <NumberInputScrubber htmlFor='windowMs' className='mb-1'>
                    Time window
                  </NumberInputScrubber>
                  <InputGroup>
                    <InputGroupAddon align='inline-start'>
                      <NumberInputDecrement />
                    </InputGroupAddon>
                    <NumberInputField id='windowMs' placeholder='60' />
                    <InputGroupAddon align='inline-end'>
                      <NumberInputIncrement />
                      <InputGroupText>s</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
              </NumberInput>
            </div>
            <div className='flex items-center gap-2'>
              <Switch
                id='perUser'
                checked={rateLimit.perUser || false}
                onCheckedChange={(checked) => handleRateLimitChange('perUser', checked)}
              />
              <Label htmlFor='perUser' className='text-sm cursor-pointer'>
                Per user (based on IP/session)
              </Label>
            </div>
          </div>
        </Section>
      )}

      {/* Revoke Access Button - shown when share token exists and any access is enabled */}
      {shareToken && hasAnyAccess && (
        <div className='flex items-center px-2 pt-4 justify-between'>
          <Button
            variant='destructive-hover'
            size='sm'
            onClick={handleRevokeAccess}
            disabled={revokeToken.isPending}>
            <Trash2 />
            Revoke All Access
          </Button>
          {isSaving && <div className='text-xs text-muted-foreground'>Saving...</div>}
        </div>
      )}
    </>
  )
})

// Re-export with old name for backwards compatibility during transition
export { WorkflowAccessSettings as WorkflowShareSettings }
