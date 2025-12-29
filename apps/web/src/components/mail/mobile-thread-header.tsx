// File: src/components/mail/mobile-thread-header.tsx
'use client'

import { ArrowLeft } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'

/**
 * Props for the MobileThreadHeader component
 */
interface MobileThreadHeaderProps {
  /** Callback function to handle back navigation */
  onBack: () => void
}

/**
 * Mobile header component for thread detail view
 * Provides back navigation to return to the thread list
 */
export function MobileThreadHeader({ onBack }: MobileThreadHeaderProps) {
  return (
    <div className="flex items-center gap-2 p-3 border-b bg-background">
      <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back
      </Button>
    </div>
  )
}
