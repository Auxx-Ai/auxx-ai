// apps/web/src/components/credentials/credential-list.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import type { CredentialTestResult } from '@auxx/workflow-nodes/types'
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  Settings,
  TestTube,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { useCredentialTest } from '~/hooks/use-credential-test'

interface CredentialItem {
  id: string
  name: string
  type: string
  createdBy: { name: string | null }
  createdAt: Date
}

interface CredentialListProps {
  credentials: CredentialItem[]
  onEdit: (credential: CredentialItem) => void
  onDelete: (credential: CredentialItem) => void
  isLoading?: boolean
}

/**
 * List of credentials with testing capabilities
 */
export function CredentialList({ credentials, onEdit, onDelete, isLoading }: CredentialListProps) {
  const [testResults, setTestResults] = useState<Record<string, CredentialTestResult>>({})
  const [testingStates, setTestingStates] = useState<Record<string, boolean>>({})

  const { testCredential } = useCredentialTest()

  /**
   * Test a specific credential
   */
  const handleTest = async (credential: CredentialItem) => {
    setTestingStates((prev) => ({ ...prev, [credential.id]: true }))

    try {
      const result = await testCredential({ id: credential.id })
      setTestResults((prev) => ({ ...prev, [credential.id]: result }))
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [credential.id]: {
          success: false,
          message: 'Test failed',
          error: {
            type: 'UNKNOWN_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      }))
    } finally {
      setTestingStates((prev) => ({ ...prev, [credential.id]: false }))
    }
  }

  /**
   * Get status icon based on test result
   */
  const getStatusIcon = (credentialId: string) => {
    const testResult = testResults[credentialId]
    const isTesting = testingStates[credentialId]

    if (isTesting) {
      return <Loader2 className='h-4 w-4 animate-spin text-blue-500' />
    }

    if (!testResult) {
      return <Clock className='h-4 w-4 text-gray-400' />
    }

    if (testResult.success) {
      return <CheckCircle className='h-4 w-4 text-green-500' />
    }

    return <XCircle className='h-4 w-4 text-red-500' />
  }

  /**
   * Get status text based on test result
   */
  const getStatusText = (credentialId: string) => {
    const testResult = testResults[credentialId]
    const isTesting = testingStates[credentialId]

    if (isTesting) return 'Testing...'
    if (!testResult) return 'Not tested'
    if (testResult.success) return 'Connected'
    return 'Failed'
  }

  /**
   * Render individual credential card
   */
  const renderCredentialCard = (credential: CredentialItem) => {
    const testResult = testResults[credential.id]
    const isTesting = testingStates[credential.id]

    return (
      <Card key={credential.id} className='relative'>
        <CardHeader className='pb-3'>
          <div className='flex items-start justify-between'>
            <div className='flex-1'>
              <CardTitle className='text-lg'>{credential.name}</CardTitle>
              <div className='flex items-center gap-2 mt-1'>
                <Badge variant='outline'>{credential.type}</Badge>
                <div className='flex items-center gap-1'>
                  {getStatusIcon(credential.id)}
                  <span className='text-sm text-muted-foreground'>
                    {getStatusText(credential.id)}
                  </span>
                </div>
              </div>
            </div>

            <div className='flex gap-1'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => handleTest(credential)}
                disabled={isTesting || isLoading}
                title='Test connection'>
                <TestTube />
              </Button>

              <Button
                variant='ghost'
                size='sm'
                onClick={() => onEdit(credential)}
                disabled={isLoading}
                title='Edit credential'>
                <Settings />
              </Button>

              <Button
                variant='ghost'
                size='sm'
                onClick={() => onDelete(credential)}
                disabled={isLoading}
                title='Delete credential'>
                <Trash2 />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className='pt-0'>
          <div className='text-sm text-muted-foreground'>
            Created by {credential.createdBy.name || 'Unknown'} on{' '}
            {credential.createdAt.toLocaleDateString()}
          </div>

          {testResult && (
            <div className='mt-3 p-3 rounded-lg border bg-muted/50'>
              <div className='flex items-start gap-2'>
                {testResult.success ? (
                  <CheckCircle className='h-4 w-4 text-green-600 mt-0.5' />
                ) : (
                  <XCircle className='h-4 w-4 text-red-600 mt-0.5' />
                )}

                <div className='flex-1'>
                  <div className='flex items-center gap-2'>
                    <span className='text-sm font-medium'>
                      {testResult.success ? 'Connected' : 'Connection Failed'}
                    </span>
                    {testResult.details?.connectionTime && (
                      <Badge variant='outline' className='text-xs'>
                        {testResult.details.connectionTime}ms
                      </Badge>
                    )}
                  </div>

                  <p className='text-xs text-muted-foreground mt-1'>{testResult.message}</p>

                  {testResult.details?.serverInfo && (
                    <p className='text-xs text-muted-foreground mt-1'>
                      {testResult.details.serverInfo}
                    </p>
                  )}

                  {testResult.details?.permissions && testResult.details.permissions.length > 0 && (
                    <div className='flex gap-1 mt-2'>
                      {testResult.details.permissions.map((permission) => (
                        <Badge key={permission} variant='secondary' className='text-xs'>
                          {permission}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {testResult.error && (
                    <div className='mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs'>
                      <div className='flex items-center gap-1'>
                        <AlertTriangle className='h-3 w-3 text-red-600' />
                        <span className='font-medium'>{testResult.error.type}</span>
                      </div>
                      <p className='text-red-700 mt-1'>{testResult.error.message}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  if (credentials.length === 0) {
    return (
      <Card>
        <CardContent className='flex flex-col items-center justify-center py-12'>
          <TestTube className='h-12 w-12 text-muted-foreground mb-4' />
          <h3 className='text-lg font-medium'>No credentials yet</h3>
          <p className='text-muted-foreground text-center max-w-sm'>
            Create your first credential to start connecting with external services.
          </p>
        </CardContent>
      </Card>
    )
  }

  return <div className='space-y-4'>{credentials.map(renderCredentialCard)}</div>
}
