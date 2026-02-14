// apps/web/src/components/workflow/credentials/node-credential-connection-dialog.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Separator } from '@auxx/ui/components/separator'
import { toastSuccess } from '@auxx/ui/components/toast'
import { ArrowLeft, ArrowRight, Settings, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { CreateCredentialDialog } from './create-credential-dialog'
import { type CredentialTypeMetadata, getCredentialType } from './credential-registry'
import { CredentialSelector } from './credential-selector'
import { CredentialTypeSelector } from './credential-type-selector'
import { EditCredentialDialog } from './edit-credential-dialog'

interface NodeCredentialConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  nodeId: string
  allowedCredentialTypes: string[]
  currentCredentialId?: string | null
  onCredentialConnected: (credentialId: string) => void
  onCredentialDisconnected: () => void
  hideCreateOption?: boolean
}

type DialogStep =
  | 'select-type'
  | 'select-credential'
  | 'create-credential'
  | 'edit-credential'
  | 'connected-actions'

/**
 * Node credential connection dialog component
 * Handles the full credential connection flow for workflow nodes
 */
export function NodeCredentialConnectionDialog({
  open,
  onOpenChange,
  nodeId,
  allowedCredentialTypes,
  currentCredentialId,
  onCredentialConnected,
  onCredentialDisconnected,
  hideCreateOption = false,
}: NodeCredentialConnectionDialogProps) {
  const [currentStep, setCurrentStep] = useState<DialogStep>('select-type')
  const [selectedCredentialType, setSelectedCredentialType] = useState<string | null>(null)
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)

  const [confirm, ConfirmDialog] = useConfirm()

  // Get current credential info if connected
  const { data: currentCredentialInfo } = api.credentials.getInfo.useQuery(
    { id: currentCredentialId! },
    { enabled: !!currentCredentialId, refetchOnWindowFocus: false }
  )

  // Initialize dialog state when opened
  useEffect(() => {
    if (open) {
      if (currentCredentialId && currentCredentialInfo) {
        // Already connected - show connection actions
        setCurrentStep('connected-actions')
        setSelectedCredentialId(currentCredentialId)
      } else if (allowedCredentialTypes.length === 1) {
        // Single credential type - skip type selection
        setSelectedCredentialType(allowedCredentialTypes[0])
        setCurrentStep('select-credential')
      } else {
        // Multiple types - show type selector
        setCurrentStep('select-type')
      }

      // Reset selections
      setSelectedCredentialType(
        allowedCredentialTypes.length === 1 ? allowedCredentialTypes[0] : null
      )
      setSelectedCredentialId(currentCredentialId)
    }
  }, [open, currentCredentialId, currentCredentialInfo, allowedCredentialTypes])

  // Get available credential types for selection
  const availableCredentialTypes = allowedCredentialTypes
    .map((typeId) => getCredentialType(typeId))
    .filter((type): type is CredentialTypeMetadata => type !== null)

  const selectedTypeInfo = selectedCredentialType ? getCredentialType(selectedCredentialType) : null

  const handleTypeSelect = (credentialType: CredentialTypeMetadata) => {
    setSelectedCredentialType(credentialType.id)
    setCurrentStep('select-credential')
  }

  const handleCredentialSelect = (credentialId: string) => {
    setSelectedCredentialId(credentialId)
  }

  const handleCreateNew = () => {
    if (selectedCredentialType) {
      setCreateDialogOpen(true)
    }
  }

  const handleCredentialCreated = (credentialId: string) => {
    setCreateDialogOpen(false)
    onCredentialConnected(credentialId)
    onOpenChange(false)
    toastSuccess({
      title: 'Credential Connected',
      description: 'Your credential has been created and connected to the node',
    })
  }

  const handleConnect = () => {
    if (selectedCredentialId) {
      onCredentialConnected(selectedCredentialId)
      onOpenChange(false)
      toastSuccess({
        title: 'Credential Connected',
        description: 'Your credential has been connected to the node',
      })
    }
  }

  const handleEdit = () => {
    if (currentCredentialId) {
      setEditDialogOpen(true)
    }
  }

  const handleDisconnect = async () => {
    const confirmed = await confirm({
      title: 'Disconnect Credential?',
      description:
        'This will remove the credential connection from this node. The credential itself will not be deleted.',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      onCredentialDisconnected()
      onOpenChange(false)
      toastSuccess({
        title: 'Credential Disconnected',
        description: 'The credential has been disconnected from this node',
      })
    }
  }

  const handleBack = () => {
    switch (currentStep) {
      case 'select-credential':
        if (allowedCredentialTypes.length > 1) {
          setCurrentStep('select-type')
          setSelectedCredentialType(null)
        }
        break
      default:
        // No back action for other steps
        break
    }
  }

  const getDialogTitle = () => {
    switch (currentStep) {
      case 'select-type':
        return 'Select Credential Type'
      case 'select-credential':
        return 'Select Credential'
      case 'connected-actions':
        return 'Credential Connected'
      default:
        return 'Connect Credential'
    }
  }

  const getDialogDescription = () => {
    switch (currentStep) {
      case 'select-type':
        return 'Choose the type of credential you want to connect to this node'
      case 'select-credential':
        return `Select an existing ${selectedTypeInfo?.displayName || 'credential'} or create a new one`
      case 'connected-actions':
        return 'Manage your connected credential'
      default:
        return ''
    }
  }

  const canGoNext = () => {
    switch (currentStep) {
      case 'select-credential':
        return !!selectedCredentialId
      default:
        return false
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-w-2xl max-h-[90vh] overflow-y-auto '>
          <DialogHeader className='pb-0'>
            <DialogTitle>{getDialogTitle()}</DialogTitle>
            <DialogDescription>{getDialogDescription()}</DialogDescription>

            {selectedTypeInfo && currentStep !== 'select-type' && (
              <>
                <Separator />
                <div className='flex items-center gap-3 pt-2'>
                  <selectedTypeInfo.icon className='h-5 w-5' />
                  <span className='font-medium'>{selectedTypeInfo.displayName}</span>
                  <Badge variant='secondary'>{selectedTypeInfo.category}</Badge>
                </div>
              </>
            )}
          </DialogHeader>

          <div className=''>
            {currentStep === 'select-type' && (
              <CredentialTypeSelector
                onSelect={handleTypeSelect}
                selectedType={selectedCredentialType}
                allowedCredentialTypes={allowedCredentialTypes}
              />
            )}

            {currentStep === 'select-credential' && (
              <CredentialSelector
                allowedCredentialTypes={
                  selectedCredentialType ? [selectedCredentialType] : allowedCredentialTypes
                }
                selectedCredentialId={selectedCredentialId}
                onCredentialSelect={handleCredentialSelect}
                onCreateNew={handleCreateNew}
                hideCreateOption={hideCreateOption}
              />
            )}

            {currentStep === 'connected-actions' && currentCredentialInfo && (
              <div className='space-y-4'>
                <div className='text-center py-6'>
                  {selectedTypeInfo && (
                    <selectedTypeInfo.icon className='h-12 w-12 mx-auto mb-4 text-primary' />
                  )}
                  <h3 className='text-lg font-medium mb-2'>{currentCredentialInfo.name}</h3>
                  <p className='text-muted-foreground'>This credential is connected to your node</p>
                </div>

                <div className='flex gap-3'>
                  <Button variant='outline' onClick={handleEdit} className='flex-1'>
                    <Settings className='w-4 h-4 mr-2' />
                    Edit Credential
                  </Button>
                  <Button variant='destructive' onClick={handleDisconnect} className='flex-1'>
                    <Trash2 className='w-4 h-4 mr-2' />
                    Disconnect
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <div className='flex justify-between w-full'>
              <Button
                variant='ghost'
                size='sm'
                onClick={handleBack}
                disabled={currentStep === 'select-type' || currentStep === 'connected-actions'}>
                <ArrowLeft />
                Back
              </Button>

              <div className='flex gap-2'>
                <Button variant='outline' onClick={() => onOpenChange(false)} size='sm'>
                  Cancel
                </Button>

                {currentStep === 'select-credential' && (
                  <Button onClick={handleConnect} disabled={!canGoNext()} size='sm'>
                    Connect
                    <ArrowRight />
                  </Button>
                )}
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create credential dialog */}
      <CreateCredentialDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        initialType={selectedCredentialType}
      />

      {/* Edit credential dialog */}
      <EditCredentialDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        credentialId={currentCredentialId}
      />

      <ConfirmDialog />
    </>
  )
}
