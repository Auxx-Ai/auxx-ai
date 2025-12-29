// apps/web/src/lib/extensions/components/workflow/layout/section.tsx

'use client'

import React from 'react'
import UISection from '~/components/workflow/ui/section'

/**
 * Section component wrapper for extensions.
 * Wraps the UI Section component and translates extension props to UI Section props.
 */
export const Section = ({
  defaultOpen = true,
  collapsible = true,
  __instanceId,
  __onCallHandler,
  __hasOnToggle,
  children,
  ...props
}: any) => {
  /** Handle onToggle callback for extensions */
  const handleOpenChange = (isOpen: boolean) => {
    if (__hasOnToggle && __onCallHandler && __instanceId) {
      __onCallHandler(__instanceId, 'onToggle', isOpen)
    }
  }

  return (
    <UISection
      {...props}
      initialOpen={defaultOpen}
      collapsible={collapsible}
      onOpenChange={handleOpenChange}>
      <div className="space-y-4">{children}</div>
    </UISection>
  )
}
