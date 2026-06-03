// apps/web/src/app/(protected)/app/kb/sources/[sourceId]/page.tsx

import { SourceWorkspace } from '~/components/kb/ui/sources/source-workspace'

export default async function SourcePage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params
  return <SourceWorkspace sourceId={sourceId} />
}
