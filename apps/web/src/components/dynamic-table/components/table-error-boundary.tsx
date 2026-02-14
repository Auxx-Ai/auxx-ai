// apps/web/src/components/dynamic-table/components/table-error-boundary.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { AlertCircle } from 'lucide-react'
import React from 'react'

interface Props {
  children: React.ReactNode
  fallback?: React.ComponentType<{ error: Error; reset: () => void }>
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Error boundary for the dynamic table component
 */
export class TableErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Table error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      const { fallback: Fallback } = this.props

      if (Fallback && this.state.error) {
        return <Fallback error={this.state.error} reset={this.handleReset} />
      }

      return (
        <div className='flex flex-col items-center justify-center p-8 text-center'>
          <AlertCircle className='h-12 w-12 text-destructive mb-4' />
          <h3 className='text-lg font-semibold mb-2'>Something went wrong</h3>
          <p className='text-sm text-muted-foreground mb-4'>
            An error occurred while rendering the table.
          </p>
          {this.state.error && (
            <details className='mb-4 text-xs text-muted-foreground'>
              <summary className='cursor-pointer'>Error details</summary>
              <pre className='mt-2 p-2 bg-muted rounded text-left overflow-auto max-w-lg'>
                {this.state.error.message}
              </pre>
            </details>
          )}
          <Button onClick={this.handleReset} variant='outline' size='sm'>
            Try again
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
