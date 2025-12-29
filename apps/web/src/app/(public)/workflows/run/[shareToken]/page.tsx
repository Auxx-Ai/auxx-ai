// apps/web/src/app/(public)/workflows/run/[shareToken]/page.tsx

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { API_URL } from '@auxx/config/urls'
import {
  WorkflowShareProvider,
  ShareGate,
  WorkflowTriggerInterface,
} from '~/components/workflow/share'

/**
 * Page props for the public workflow run page
 * Note: Next.js 15 requires params to be a Promise
 */
interface PageProps {
  params: Promise<{ shareToken: string }>
}

/**
 * Fetch workflow info for metadata (server-side)
 */
async function getWorkflowInfo(shareToken: string) {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/workflows/share/${shareToken}/site?includeGraph=false`,
      { next: { revalidate: 60 } }
    )

    if (!res.ok) return null

    const { data } = await res.json()
    return data
  } catch {
    return null
  }
}

/**
 * Generate metadata for the workflow run page
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { shareToken } = await params
  const info = await getWorkflowInfo(shareToken)

  if (!info) {
    return {
      title: 'Workflow Not Found - Auxx.ai',
    }
  }

  return {
    title: `${info.site.title} - Auxx.ai`,
    description: info.site.description || 'Execute this automated workflow',
    openGraph: {
      title: info.site.title,
      description: info.site.description || 'Execute this automated workflow',
      images: info.site.logoUrl ? [info.site.logoUrl] : undefined,
    },
  }
}

/**
 * Public workflow run page
 * Accessible without authentication via share token
 */
export default async function PublicWorkflowRunPage({ params }: PageProps) {
  const { shareToken } = await params

  // Pre-validate that the workflow exists (server-side)
  const info = await getWorkflowInfo(shareToken)

  if (!info) {
    notFound()
  }

  return (
    <div className="h-screen w-screen overflow-hidden">
      <WorkflowShareProvider>
        <ShareGate shareToken={shareToken}>
          <WorkflowTriggerInterface />
        </ShareGate>
      </WorkflowShareProvider>
    </div>
  )
}
