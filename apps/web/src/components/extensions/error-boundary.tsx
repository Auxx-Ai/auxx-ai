// apps/web/src/components/extensions/error-boundary.tsx
'use client'

import React, { Component, type ReactNode } from 'react'

/**
 * Props for the ErrorBoundary component.
 */
interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

/**
 * State for the ErrorBoundary component.
 */
interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Error boundary for extension components.
 * Prevents extension errors from crashing the entire app.
 *
 * - Catches errors in extension widget rendering
 * - Displays user-friendly error message
 * - Logs detailed error info for debugging
 * - Isolates extension failures from platform
 *
 * @example
 * ```tsx
 * <ErrorBoundary>
 *   <ExtensionWidget {...props} />
 * </ErrorBoundary>
 * ```
 *
 * @example With custom fallback
 * ```tsx
 * <ErrorBoundary fallback={<div>Custom error UI</div>}>
 *   <ExtensionWidget {...props} />
 * </ErrorBoundary>
 * ```
 *
 * @example With error callback
 * ```tsx
 * <ErrorBoundary
 *   fallback={null}
 *   onError={(error) => console.error('Extension failed:', error)}
 * >
 *   <ExtensionWidget {...props} />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Extension error:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="rounded-md border border-destructive bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Extension Error</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {this.state.error?.message || 'An error occurred in the extension'}
          </p>
        </div>
      )
    }

    return this.props.children
  }
}
