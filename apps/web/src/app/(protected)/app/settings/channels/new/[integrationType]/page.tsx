'use client'
import { useParams } from 'next/navigation'
import IntegrationForm from '../../_components/integration-form'

/**
 * Integration Connection Page
 * Displays the appropriate form based on the integration type
 */
export default function IntegrationConnectionPage() {
  const { integrationType } = useParams<{ integrationType: string }>()

  return <IntegrationForm type={integrationType} />
}
