'use client'
import { Button } from '@auxx/ui/components/button'
// import { processUnifiedModelData } from './utils'
import { cn } from '@auxx/ui/lib/utils'
import { BarChart3, BotIcon, Plus, RefreshCw } from 'lucide-react'

import { AnimatePresence, motion } from 'motion/react'
import React from 'react'
import { ModelRow } from '~/components/ai/ui/model-row'
// New components
import { ProviderRow } from '~/components/ai/ui/provider-row'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useUser } from '~/hooks/use-user'
import { api, type RouterOutputs } from '~/trpc/react'
import { AiUsageDialog } from './ai-usage-dialog'
import { BadgeAiQuota } from './badge-ai-quota'
import { CredentialConfigurationDialog } from './credential-configuration-dialog'
import { SystemModelSettingsDialog } from './system-model-settings-dialog'

interface AiModelsListProps {
  initialUnifiedData?: RouterOutputs['aiIntegration']['getUnifiedModelData']
}

export function AiModelsList({ initialUnifiedData }: AiModelsListProps) {
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [dialogMode, setDialogMode] = React.useState<'provider' | 'custom-model'>('provider')
  const [dialogOperation, setDialogOperation] = React.useState<'create' | 'edit'>('create')
  const [selectedProvider, setSelectedProvider] = React.useState<string | undefined>()
  const [expandedProviders, setExpandedProviders] = React.useState<Set<string>>(new Set())
  useUser({
    requireOrganization: true, // Require organization membership
    requireRoles: ['ADMIN', 'OWNER'], // Ensure user is an admin or owner
  })

  const utils = api.useUtils()
  // Use new unified model data API
  const { data, isLoading } = api.aiIntegration.getUnifiedModelData.useQuery(
    { includeDefaults: true },
    { initialData: initialUnifiedData }
  )
  const providersData = data?.providers || []

  // Org-level AI credit pool. Rendered once in the header bar.
  const { data: quotaStatus } = api.aiIntegration.getQuotaStatus.useQuery()
  // Process data to add capabilities
  // const providersData = React.useMemo(() => {
  //   return processUnifiedModelData(unifiedData)
  // }, [unifiedData])

  // Provider expansion handlers
  const toggleProvider = (providerId: string) => {
    setExpandedProviders((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(providerId)) {
        newSet.delete(providerId)
      } else {
        newSet.add(providerId)
      }
      return newSet
    })
  }

  const handleSetup = (provider: string) => {
    // Open provider setup dialog for specific provider
    setDialogMode('provider')
    setDialogOperation('create')
    setSelectedProvider(provider)
    setIsDialogOpen(true)
  }

  const handleEdit = (provider: string) => {
    // Open provider edit dialog for specific provider
    setDialogMode('provider')
    setDialogOperation('edit')
    setSelectedProvider(provider)
    setIsDialogOpen(true)
  }

  const handleCreateCustomModel = (provider: string) => {
    // Open custom model creation dialog for specific provider
    setDialogMode('custom-model')
    setDialogOperation('create')
    setSelectedProvider(provider)
    setIsDialogOpen(true)
  }

  // No-ops: the dialog's onSuccess already invalidates getUnifiedModelData
  const handleModelCreated = () => {}
  const handleProviderConfigured = () => {}

  const handleCreateGeneric = () => {
    // Open generic create dialog (no specific provider)
    setDialogMode('provider')
    setDialogOperation('create')
    setSelectedProvider(undefined)
    setIsDialogOpen(true)
  }

  return (
    <SettingsPage
      title='AI Models'
      description='Connect your AI provider to Auxx.Ai'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'AI Models' }]}
      button={<div className='flex gap-2'></div>}>
      {isLoading ? (
        <EmptyState
          icon={RefreshCw}
          iconClassName='animate-spin'
          title='Loading models...'
          description={<>Hang on tight while we load your models...</>}
          button={<div className='h-12'></div>}
        />
      ) : !providersData || providersData.length === 0 ? (
        <EmptyState
          icon={BotIcon}
          title='Add your first AI model'
          description={<>Add OpenAI, Anthropic, and other AI providers</>}
          button={
            <Button size='sm' variant='outline' onClick={handleCreateGeneric}>
              <Plus />
              Connect Provider
            </Button>
          }
        />
      ) : (
        <div className='flex-1 h-full shrink-0 flex flex-col @container'>
          <div className='h-12 shrink-0 flex items-center justify-between border-b px-2 gap-2 bg-primary-200/50 dark:bg-primary-100/50 sticky top-[67px] z-10 backdrop-blur'>
            <div className='flex items-center gap-2'>
              {quotaStatus && (
                <BadgeAiQuota
                  quotaType={quotaStatus.quotaType}
                  quotaUsed={quotaStatus.quotaUsed}
                  quotaLimit={quotaStatus.quotaLimit}
                  bonusCredits={quotaStatus.bonusCredits}
                  resetsAt={quotaStatus.quotaPeriodEnd}
                />
              )}
            </div>
            <div className='flex items-center gap-2'>
              <AiUsageDialog
                trigger={
                  <Button variant='outline' size='sm'>
                    <BarChart3 />
                    <span className='hidden @md:inline'>View Usage</span>
                  </Button>
                }
              />
              <SystemModelSettingsDialog />
              <Button variant='outline' size='sm' onClick={handleCreateGeneric}>
                <Plus />
                <span className='hidden @lg:inline'>Add Provider</span>
              </Button>
            </div>
          </div>
          <div className='space-y-0'>
            {providersData.map((provider) => {
              const isExpanded = expandedProviders.has(provider.provider)

              return (
                <div
                  key={provider.provider}
                  className={cn(isExpanded && 'bg-primary-150 ring-1 ring-primary-200')}>
                  {/* Provider Row */}
                  <ProviderRow
                    provider={provider}
                    isExpanded={isExpanded}
                    onToggle={() => toggleProvider(provider.provider)}
                    onSetup={handleSetup}
                    onEdit={handleEdit}
                    onCreateCustomModel={handleCreateCustomModel}
                  />

                  {/* Expanded Models */}
                  <AnimatePresence initial={false}>
                    {isExpanded && provider.models && provider.models.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0, filter: 'blur(3px)', overflow: 'hidden' }}
                        animate={{
                          height: 'auto',
                          opacity: 1,
                          filter: 'blur(0px)',
                          overflow: 'hidden',
                          transitionEnd: { overflow: 'visible' },
                        }}
                        exit={{ height: 0, opacity: 0, filter: 'blur(3px)', overflow: 'hidden' }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
                        <div className='p-2 inset-shadow-sm'>
                          <div className='bg-background rounded-md'>
                            {provider.models.map((model) => {
                              const modelId = `${provider.provider}:${model.modelId}`
                              return (
                                <ModelRow
                                  key={modelId}
                                  model={model}
                                  provider={provider}
                                  providers={providersData}
                                />
                              )
                            })}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Empty state for expanded provider with no models */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (!provider.models || provider.models.length === 0) && (
                      <motion.div
                        initial={{ height: 0, opacity: 0, filter: 'blur(3px)', overflow: 'hidden' }}
                        animate={{
                          height: 'auto',
                          opacity: 1,
                          filter: 'blur(0px)',
                          overflow: 'hidden',
                          transitionEnd: { overflow: 'visible' },
                        }}
                        exit={{ height: 0, opacity: 0, filter: 'blur(3px)', overflow: 'hidden' }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
                        <div className='py-8 px-12 text-center text-muted-foreground bg-muted/10'>
                          <BotIcon className='h-8 w-8 mx-auto mb-2 text-muted-foreground/50' />
                          <p className='text-sm'>No models configured for this provider</p>
                          <Button
                            variant='outline'
                            size='sm'
                            className='mt-2'
                            onClick={() => handleCreateCustomModel(provider.provider)}>
                            <Plus />
                            Add Model
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Unified Credential Configuration Dialog */}
      <CredentialConfigurationDialog
        mode={dialogMode}
        provider={selectedProvider}
        operation={dialogOperation}
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onProviderConfigured={handleProviderConfigured}
        onModelCreated={handleModelCreated}
        providers={providersData}
      />
    </SettingsPage>
  )
}
