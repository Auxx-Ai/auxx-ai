// packages/lib/scripts/mcp-phase2-e2e.ts
//
// Phase 2 checkpoint: mock server → McpServer (+secret def) → saveMcpConnection(bearer) →
// syncMcpTools → assert McpInstallation.tools + provider projection. Cleans up.
//
// Run from repo root:
//   npx dotenv -- npx tsx packages/lib/scripts/mcp-phase2-e2e.ts [organizationId]

import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.resolve(here, '../../../.env') })

const { database, schema } = await import('@auxx/database')
const { eq } = await import('drizzle-orm')
const { saveMcpConnection, syncMcpTools } = await import('../src/ai/mcp')
// Import the provider's compute directly (relative source) to avoid the heavy cache barrel.
const { mcpServersProvider } = await import('../src/cache/providers/mcp-servers-provider')

const organizationId = process.argv[2] ?? 'abgwpa1l81reht2zmwrcihfu' // DemoOrg
const BEARER = 'sk-phase2-bearer'

// Inline minimal Streamable HTTP mock.
async function startMockMcpServer(token: string) {
  const tools = [
    {
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
      annotations: { readOnlyHint: true },
    },
    { name: 'do_write', description: 'Write', inputSchema: { type: 'object' } },
  ]
  const server = createServer((req, res) => {
    if (req.method !== 'POST') return res.writeHead(405).end()
    if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end()
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      const msg = JSON.parse(body)
      if (msg.id === undefined || msg.id === null) return res.writeHead(202).end()
      const result =
        msg.method === 'initialize'
          ? {
              protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'mock', version: '1' },
            }
          : msg.method === 'tools/list'
            ? { tools }
            : { content: [{ type: 'text', text: '{}' }], isError: false }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

async function main() {
  const member = await database.query.OrganizationMember.findFirst({
    where: (m, { eq }) => eq(m.organizationId, organizationId),
    columns: { userId: true },
  })
  const createdById = member?.userId
  if (!createdById) throw new Error(`No member for org ${organizationId}`)

  const mock = await startMockMcpServer(BEARER)
  console.log('✓ mock server at', mock.url)

  const [server] = await database
    .insert(schema.McpServer)
    .values({
      organizationId,
      slug: `phase2-${Date.now()}`,
      name: 'Phase 2 Server',
      endpoint: mock.url,
      createdById,
    })
    .returning({ id: schema.McpServer.id })
  if (!server) throw new Error('insert McpServer failed')

  await database.insert(schema.ConnectionDefinition).values({
    mcpServerId: server.id,
    major: 1,
    connectionType: 'secret',
    label: 'Phase 2 Connection',
    global: true,
    createdById,
  })

  const saved = await saveMcpConnection({
    mcpServerId: server.id,
    serverName: 'Phase 2 Server',
    organizationId,
    createdById,
    connectionData: { secret: BEARER },
  })
  if (saved.isErr()) throw new Error(saved.error.message)
  console.log('✓ saved bearer connection')

  const sync = await syncMcpTools({ mcpServerId: server.id, organizationId })
  if (!sync.ok) throw new Error(`sync failed: ${sync.error}`)
  console.log('✓ syncMcpTools →', sync.toolCount, 'tools')

  const install = await database.query.McpInstallation.findFirst({
    where: (i, { eq, and }) =>
      and(eq(i.mcpServerId, server.id), eq(i.organizationId, organizationId)),
  })
  if (install?.tools.length !== 2) throw new Error(`expected 2 tools, got ${install?.tools.length}`)
  console.log('✓ McpInstallation.tools has 2 entries')

  // Provider projection against real rows (proves readOnlyHint/trusted derivation).
  const projected = await mcpServersProvider.compute(organizationId, database)
  const entry = projected.find((s) => s.serverId === server.id)
  if (!entry) throw new Error('server missing from projection')
  const echo = entry.tools.find((t) => t.name === 'echo')
  if (!echo?.readOnlyHint) throw new Error('echo readOnlyHint not derived')
  console.log('✓ provider projection:', {
    connectionPresent: entry.connectionPresent,
    connectionType: entry.connectionType,
    tools: entry.tools.map((t) => ({ name: t.name, readOnly: t.readOnlyHint, trusted: t.trusted })),
  })

  await database.delete(schema.McpServer).where(eq(schema.McpServer.id, server.id))
  await mock.close()
  console.log('\n✅ Phase 2 e2e passed')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌', err)
    process.exit(1)
  })
