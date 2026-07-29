// apps/homepage/src/app/platform/integration/_components/mcp-section.tsx

import { Boxes, Plug, RefreshCw, ShieldCheck } from 'lucide-react'
import { BrandMark } from '~/components/brand-mark'
import McpFlowIllustration from './mcp-flow-illustration'

/** The curated catalog shipped in `packages/lib/src/ai/mcp/templates/catalog.ts`. */
const curatedServers = [
  { name: 'Linear', logo: '/images/brands/linear.svg' },
  { name: 'Notion', logo: '/images/brands/notion.svg' },
  { name: 'Shopify', logo: '/images/brands/shopify.svg' },
  { name: 'GitHub', logo: '/images/brands/github.svg' },
  { name: 'Sentry', logo: '/images/brands/sentry.svg' },
  { name: 'Stripe', logo: '/images/brands/stripe.svg' },
  { name: 'PayPal', logo: '/images/brands/paypal.svg' },
  { name: 'Context7', logo: '/images/brands/context7.svg' },
  { name: 'Hugging Face', logo: '/images/brands/huggingface.svg' },
  { name: 'Zapier', logo: '/images/brands/zapier.svg' },
  { name: 'DeepWiki', logo: '/images/brands/deepwiki.svg' },
  { name: 'Exa', logo: '/images/brands/exa.svg' },
]

/**
 * Model Context Protocol section — how external MCP servers extend agents, and the trust model
 * that keeps their write tools in check.
 */
export default function McpSection() {
  return (
    <section id='mcp' className='overflow-hidden scroll-mt-24'>
      <div className='bg-background py-24'>
        <div className='mx-auto w-full max-w-5xl px-6'>
          <div className='mx-auto max-w-3xl pb-12 text-center'>
            <h2 className='text-foreground text-balance text-4xl font-semibold'>
              Any MCP server, connected in one URL
            </h2>
            <p className='text-muted-foreground my-6 text-balance text-lg'>
              Model Context Protocol servers give your agents tools they didn&apos;t ship with. Pick
              one from the curated catalog or paste a Streamable HTTP endpoint — Auxx detects the
              auth, registers itself, and syncs the tools.
            </p>
          </div>

          <div className='w-full pb-12'>
            <McpFlowIllustration />
          </div>

          <div className='relative grid grid-cols-2 gap-x-3 gap-y-6 border-t pt-12 sm:gap-6 lg:grid-cols-4'>
            <div className='space-y-3'>
              <div className='flex items-center gap-2'>
                <Plug className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Any server, one URL</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Connect a curated server or paste your own endpoint. Auth is auto-detected and the
                client registers itself — no client IDs to copy across.
              </p>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <Boxes className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Extends every agent</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                MCP tools land in the same catalog as built-in app tools. Enable a toolset on any
                agent, or on Kopilot, and new tools are picked up on the next sync.
              </p>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <ShieldCheck className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Trust and approvals</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Read-only tools run on their own; writes wait for approval until you trust them.
                Autonomous runs skip untrusted write tools entirely.
              </p>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <RefreshCw className='text-foreground fill-foreground/10 size-4' />
                <h3 className='text-sm font-medium'>Always current</h3>
              </div>
              <p className='text-muted-foreground text-sm'>
                Tool snapshots refresh nightly and on demand, and a server surfaces a reconnect
                state the moment its credentials lapse.
              </p>
            </div>
          </div>

          <div className='mt-16 border-t pt-12 text-center'>
            <ul className='flex flex-wrap items-center justify-center gap-3'>
              {curatedServers.map((server) => (
                <li key={server.name}>
                  <BrandMark src={server.logo} name={server.name} className='size-10' />
                </li>
              ))}
            </ul>
            <p className='text-muted-foreground mx-auto mt-6 max-w-md text-balance text-sm'>
              Curated servers, ready to connect. Or bring any Streamable HTTP endpoint of your own.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
