'use client'
import { useParams } from 'next/navigation'
// ~/app/(protected)/app/settings/integrations/new/[integrationType]/page.tsx
import React from 'react'
import IntegrationForm from '../../_components/integration-form'

/**
 * Integration Connection Page
 * Displays the appropriate form based on the integration type
 */
export default function IntegrationConnectionPage() {
  const { integrationType } = useParams<{ integrationType: string }>()

  return <IntegrationForm type={integrationType} />
}
