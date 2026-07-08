// apps/web/src/components/dashboard/ui/widget/widget-error-boundary.tsx
'use client'

// Per-widget error boundary so one broken widget config can't take down the
// whole grid. Class component (the app's boundary pattern — see
// dynamic-table/components/table-error-boundary.tsx; `react-error-boundary` is
// not a dependency). Renders `WidgetError` in place — no toast.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { WidgetError } from './widget-states'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Dashboard widget error:', error, info)
  }

  render() {
    if (this.state.error) return <WidgetError message={this.state.error.message} />
    return this.props.children
  }
}
