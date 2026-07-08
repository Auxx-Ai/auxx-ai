// apps/web/src/components/workflow/panels/run/components/trace-render-boundary.tsx

'use client'

import { Component, type ReactNode } from 'react'

interface TraceRenderBoundaryProps {
  /** Rendered when the trace renderer throws (corrupt/legacy outputs). */
  fallback?: ReactNode
  children: ReactNode
}

/**
 * Error boundary around node trace ("Preview") renderers — a renderer crashing on
 * unexpected output shapes must never take down the run panel or the node panel.
 */
export class TraceRenderBoundary extends Component<
  TraceRenderBoundaryProps,
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null
    return this.props.children
  }
}

/**
 * Raw-JSON fallback body for trace renderers that decide their outputs are not
 * renderable (e.g. legacy runs missing enriched fields).
 */
export function TraceRawJson({ value }: { value: unknown }) {
  return (
    <pre className='p-3 bg-muted rounded-md text-xs overflow-auto max-h-[300px] font-mono'>
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
