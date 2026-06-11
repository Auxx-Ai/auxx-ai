// apps/web/src/app/(protected)/app/settings/apps/mcp/[slug]/page.tsx

import { notFound } from 'next/navigation'
import { McpServerDetail } from '~/components/mcp/ui/mcp-server-detail'
import { api } from '~/trpc/server'

type Props = { params: Promise<{ slug: string }> }

/**
 * MCP server detail page (reserved `mcp/` sub-route — no collision with app slugs). Server
 * component that fetches the server and hands it to the client detail shell.
 */
export default async function McpServerDetailPage({ params }: Props) {
  const { slug } = await params
  const server = await api.mcp.getBySlug({ slug })
  if (!server) notFound()
  return <McpServerDetail initialServer={server} />
}
