// apps/web/src/components/workflow/nodes/core/ai/tool-credential-dialog.tsx

'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Key, Trash2, Wrench } from 'lucide-react'
import { useState } from 'react'
import { CreateCredentialDialog } from '~/components/workflow/credentials/create-credential-dialog'
import { getCredentialType } from '~/components/workflow/credentials/credential-registry'
import { CredentialSelector } from '~/components/workflow/credentials/credential-selector'
import { getToolCredentialRequirement } from './tool-credential-registry'

interface ToolCredentialDialogProps {
  isOpen: boolean
  onClose: () => void
  toolId: string
  toolName: string
  toolType: 'workflow_node' | 'built_in'
  nodeType?: string
  currentCredentialId?: string
  onCredentialSelect: (credentialId: string) => void
  onCredentialRemove?: () => void
}

/**
 * Dialog for configuring credentials for a specific tool
 */
export function ToolCredentialDialog({
  isOpen,
  onClose,
  toolId,
  toolName,
  toolType,
  nodeType,
  currentCredentialId,
  onCredentialSelect,
  onCredentialRemove,
}: ToolCredentialDialogProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const requirement = getToolCredentialRequirement(toolId, toolType, nodeType)

  if (!requirement) return null

  const handleCredentialSelect = (credentialId: string) => {
    onCredentialSelect(credentialId)
    onClose()
  }

  const handleRemoveCredential = () => {
    if (onCredentialRemove) {
      onCredentialRemove()
    } else {
      onCredentialSelect('')
    }
    onClose()
  }

  const handleCreateNew = () => {
    setCreateDialogOpen(true)
  }

  const handleCredentialCreated = (credentialId: string) => {
    setCreateDialogOpen(false)
    handleCredentialSelect(credentialId)
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className='max-w-lg max-h-[80vh] flex flex-col'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <Key className='h-5 w-5' />
              Configure Authentication
            </DialogTitle>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <Wrench className='h-4 w-4 text-muted-foreground' />
                <span className='font-medium'>{toolName}</span>
                <Badge variant='outline' className='text-xs'>
                  {toolType === 'workflow_node' ? `${nodeType} node` : 'Built-in tool'}
                </Badge>
              </div>
              {requirement.description && (
                <p className='text-sm text-muted-foreground'>{requirement.description}</p>
              )}
            </div>
          </DialogHeader>

          <div className='flex-1 space-y-4 overflow-auto'>
            {/* Required credential warning */}
            {requirement.isCredentialRequired && !currentCredentialId && (
              <Alert variant='destructive'>
                <AlertTriangle className='h-4 w-4' />
                <AlertDescription>
                  This tool requires authentication to function properly.
                </AlertDescription>
              </Alert>
            )}

            {/* Current credential display */}
            {currentCredentialId && (
              <div className='p-3 bg-muted rounded-lg'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <Key className='h-4 w-4 text-emerald-600' />
                    <span className='text-sm font-medium'>Currently authenticated</span>
                  </div>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={handleRemoveCredential}
                    className='text-destructive hover:text-destructive'>
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            )}

            {/* Supported credential types */}
            {requirement.requiredCredentialTypes.length > 0 && (
              <div className='space-y-2'>
                <label className='text-sm font-medium'>Supported Authentication Types</label>
                <div className='flex flex-wrap gap-1'>
                  {requirement.requiredCredentialTypes.map((credType) => {
                    const credentialType = getCredentialType(credType)
                    return (
                      <Badge key={credType} variant='secondary' className='text-xs'>
                        {credentialType?.displayName || credType}
                      </Badge>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Credential selector */}
            <div className='space-y-2'>
              <label className='text-sm font-medium'>
                {currentCredentialId ? 'Change Authentication' : 'Select Authentication'}
              </label>
              <div className='border rounded-lg p-3'>
                <CredentialSelector
                  allowedCredentialTypes={requirement.requiredCredentialTypes}
                  selectedCredentialId={currentCredentialId}
                  onCredentialSelect={handleCredentialSelect}
                  onCreateNew={handleCreateNew}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={onClose}>
              Cancel
            </Button>
            {!requirement.isCredentialRequired && currentCredentialId && (
              <Button
                variant='ghost'
                onClick={handleRemoveCredential}
                className='text-destructive hover:text-destructive'>
                Remove Authentication
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create credential dialog */}
      <CreateCredentialDialog
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCredentialCreated={handleCredentialCreated}
        allowedCredentialTypes={requirement.requiredCredentialTypes}
      />
    </>
  )
}

/**
 * Simplified version for inline credential configuration
 */
export function InlineToolCredentialSelector({
  toolId,
  toolName,
  toolType,
  nodeType,
  currentCredentialId,
  onCredentialSelect,
  className,
}: Omit<ToolCredentialDialogProps, 'isOpen' | 'onClose'> & { className?: string }) {
  const [dialogOpen, setDialogOpen] = useState(false)

  const requirement = getToolCredentialRequirement(toolId, toolType, nodeType)

  if (!requirement || requirement.requiredCredentialTypes.length === 0) {
    return null
  }

  const hasCredential = !!currentCredentialId
  const isRequired = requirement.isCredentialRequired
  const needsAttention = isRequired && !hasCredential

  return (
    <>
      <Button
        variant={needsAttention ? 'destructive' : hasCredential ? 'default' : 'outline'}
        size='xs'
        onClick={() => setDialogOpen(true)}
        className={cn('text-xs', className)}>
        {needsAttention && <AlertTriangle className='h-3 w-3 mr-1' />}
        {hasCredential && <Key className='h-3 w-3 mr-1' />}
        {!hasCredential && <Key className='h-3 w-3 mr-1' />}
        {hasCredential ? 'Authenticated' : isRequired ? 'Auth Required' : 'Configure Auth'}
      </Button>

      <ToolCredentialDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        toolId={toolId}
        toolName={toolName}
        toolType={toolType}
        nodeType={nodeType}
        currentCredentialId={currentCredentialId}
        onCredentialSelect={onCredentialSelect}
      />
    </>
  )
}
