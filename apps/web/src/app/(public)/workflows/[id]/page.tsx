// apps/web/src/app/(public)/workflows/[id]/page.tsx

import type { Metadata } from 'next'
import { DynamicWorkflowViewer, ViewerThemeSync } from '~/components/workflow/viewer'

/**
 * Page props for the public workflow viewer
 */
interface WorkflowPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    theme?: 'light' | 'dark'
    title?: string
    minimap?: string
    navigation?: string
    branding?: string
  }>
}

/**
 * Generate metadata for the workflow page
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Workflow Viewer - Auxx.ai',
    description: 'View and explore this automation workflow',
  }
}

/**
 * Public workflow viewer page
 * Accessible without authentication
 */
export default async function PublicWorkflowPage({ params, searchParams }: WorkflowPageProps) {
  const { id } = await params
  const { theme, title, minimap, navigation, branding } = await searchParams

  return (
    <div className='h-screen w-screen overflow-hidden'>
      <ViewerThemeSync theme={theme} />
      <DynamicWorkflowViewer
        workflowId={id}
        theme={theme}
        options={{
          showTitle: title !== 'false',
          showMinimap: minimap !== 'false',
          showNavigation: navigation !== 'false',
          showBranding: branding !== 'false',
        }}
        className='h-full w-full'
      />
    </div>
  )
}
