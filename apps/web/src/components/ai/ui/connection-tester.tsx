// ~/app/(protected)/app/settings/aiModels/_components/connection-tester.tsx
'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { AlertCircle, CheckCircle, Loader2, XCircle } from 'lucide-react'

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error'

interface ConnectionTesterProps {
  /** Current connection status */
  status: ConnectionStatus
  /** Error message if connection failed */
  errorMessage?: string
  /** Success message for valid connection */
  successMessage?: string
  /** Function to trigger connection test */
  onTest: () => void
  /** Whether the test button should be disabled */
  disabled?: boolean
  /** Whether to show the test button */
  showTestButton?: boolean
}

export function ConnectionTester({
  status,
  errorMessage,
  successMessage = 'Connection successful!',
  onTest,
  disabled = false,
  showTestButton = true,
}: ConnectionTesterProps) {
  const getStatusDisplay = () => {
    switch (status) {
      case 'testing':
        return {
          icon: <Loader2 className='h-4 w-4 animate-spin' />,
          text: 'Testing connection...',
          variant: 'secondary' as const,
        }
      case 'success':
        return {
          icon: <CheckCircle className='h-4 w-4' />,
          text: 'Connected',
          variant: 'default' as const,
          className: 'bg-green-100 text-green-800 hover:bg-green-100',
        }
      case 'error':
        return {
          icon: <XCircle className='h-4 w-4' />,
          text: 'Connection failed',
          variant: 'destructive' as const,
        }
      default:
        return null
    }
  }

  const statusDisplay = getStatusDisplay()

  return (
    <div className='space-y-3'>
      {/* Test Button and Status Badge */}
      <div className='flex items-center justify-between'>
        {showTestButton && (
          <Button
            variant='outline'
            size='sm'
            onClick={onTest}
            disabled={disabled || status === 'testing'}
            loading={status === 'testing'}
            loadingText='Testing...'>
            Test Connection
          </Button>
        )}

        {statusDisplay && (
          <Badge variant={statusDisplay.variant} className={statusDisplay.className}>
            <div className='flex items-center gap-1'>
              {statusDisplay.icon}
              {statusDisplay.text}
            </div>
          </Badge>
        )}
      </div>

      {/* Success Message */}
      {status === 'success' && (
        <Alert>
          <CheckCircle className='h-4 w-4 text-green-600' />
          <AlertDescription className='text-green-800'>{successMessage}</AlertDescription>
        </Alert>
      )}

      {/* Error Message */}
      {status === 'error' && errorMessage && (
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>
            <div className='space-y-1'>
              <p className='font-medium'>Connection test failed</p>
              <p className='text-sm'>{errorMessage}</p>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Testing Progress */}
      {status === 'testing' && (
        <Alert>
          <Loader2 className='h-4 w-4 animate-spin' />
          <AlertDescription>Testing your credentials with the provider...</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
