// apps/homepage/src/app/platform/integration/_components/mcp-flow-illustration.tsx
'use client'

import { Check, ShieldCheck, X, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { Logo } from '~/components/logo'
import { cn } from '~/lib/utils'

const CYCLE_DURATION = 2600

interface McpServer {
  name: string
  logo: string
}

/** Order matters — each entry owns the beam gradient at its row (`mcpBeam1/2/3`). */
const servers: McpServer[] = [
  { name: 'Linear', logo: '/images/brands/linear.svg' },
  { name: 'Shopify', logo: '/images/brands/shopify.svg' },
  { name: 'Stripe', logo: '/images/brands/stripe.svg' },
]

interface ToolCall {
  server: string
  logo: string
  tool: string
  readOnly: boolean
}

const toolCalls: ToolCall[] = [
  {
    server: 'linear',
    logo: '/images/brands/linear.svg',
    tool: 'create_issue',
    readOnly: false,
  },
  {
    server: 'shopify',
    logo: '/images/brands/shopify.svg',
    tool: 'get_order',
    readOnly: true,
  },
  {
    server: 'stripe',
    logo: '/images/brands/stripe.svg',
    tool: 'list_invoices',
    readOnly: true,
  },
]

/**
 * `compact` stacks the mark above the name so all three cards fit one phone-width row — the
 * mobile merge curves assume three evenly spaced columns.
 */
const ServerCard = ({ server, compact = false }: { server: McpServer; compact?: boolean }) => (
  <div
    className={cn(
      'bg-illustration ring-border-illustration shadow-black/6.5 rounded-xl shadow-md ring-1',
      compact
        ? 'flex w-24 flex-col items-center gap-1.5 p-2 text-center'
        : 'flex w-40 items-center gap-2 p-2.5'
    )}>
    <span className='flex size-7 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-black/5'>
      <Image src={server.logo} alt='' width={20} height={20} className='size-4 object-contain' />
    </span>
    <div className='min-w-0'>
      <div className='truncate text-[11px] font-semibold'>{server.name}</div>
      <div className='text-foreground/60 text-[9px]'>MCP server</div>
    </div>
  </div>
)

/** Cycles through real tool calls; the status pill swaps with the tool's read-only flag. */
const ToolCallCard = () => {
  const [active, setActive] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setActive((prev) => (prev + 1) % toolCalls.length)
    }, CYCLE_DURATION)
    return () => clearInterval(interval)
  }, [])

  const call = toolCalls[active]!

  return (
    <div className='relative'>
      <div className='absolute inset-0 opacity-50 dark:opacity-15'>
        <div
          className={cn(
            'absolute inset-1 animate-pulse rounded-xl bg-gradient-to-r blur-md',
            call.readOnly ? 'from-emerald-400 to-teal-500' : 'from-amber-400 to-orange-500'
          )}
        />
      </div>
      <div className='ring-foreground/15 shadow-black/6.5 from-card to-card/50 bg-radial relative w-44 overflow-hidden rounded-xl shadow-md ring-1 backdrop-blur'>
        <AnimatePresence initial={false} mode='popLayout'>
          <motion.div
            key={active}
            initial={{ opacity: 0, scale: 0.9, filter: 'blur(12px)', y: -56 }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0)', y: 0 }}
            exit={{ opacity: 0, scale: 0.9, filter: 'blur(12px)', y: 56 }}
            transition={{ duration: 0.5, type: 'spring', bounce: 0.2 }}
            className='space-y-2 p-2.5'>
            <div className='flex items-center gap-2'>
              <span className='flex size-6 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-black/5'>
                <Image
                  src={call.logo}
                  alt=''
                  width={16}
                  height={16}
                  className='size-3.5 object-contain'
                />
              </span>
              <code className='text-foreground/80 truncate font-mono text-[10px]'>
                mcp__{call.server}
              </code>
            </div>
            <code className='text-foreground block truncate font-mono text-[11px] font-semibold'>
              {call.tool}
            </code>
            <div
              className={cn(
                'flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-medium',
                call.readOnly
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              )}>
              {call.readOnly ? <Zap className='size-2.5' /> : <ShieldCheck className='size-2.5' />}
              {call.readOnly ? 'Read-only' : 'Write'}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

const AutoRunCard = () => (
  <div className='bg-card/75 ring-border-illustration shadow-black/6.5 w-44 overflow-hidden rounded-xl shadow-md ring-1'>
    <div className='flex items-center gap-1.5 px-3 py-1.5'>
      <Zap className='size-3 text-emerald-500' />
      <span className='truncate text-[10px] font-semibold'>Runs automatically</span>
    </div>
    <div className='bg-illustration border-border/50 space-y-1.5 border-t p-3'>
      <div className='bg-foreground/15 h-1 w-full rounded-full' />
      <div className='bg-foreground/15 h-1 w-4/5 rounded-full' />
      <div className='bg-foreground/15 h-1 w-3/5 rounded-full opacity-70' />
      <div className='flex items-center justify-between pt-1'>
        <span className='text-muted-foreground text-[9px]'>read-only tool</span>
        <span className='rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400'>
          no prompt
        </span>
      </div>
    </div>
  </div>
)

const ApprovalCard = () => (
  <div className='bg-card/75 ring-border-illustration shadow-black/6.5 w-44 overflow-hidden rounded-xl shadow-md ring-1'>
    <div className='flex items-center gap-1.5 px-3 py-1.5'>
      <ShieldCheck className='size-3 text-amber-500' />
      <span className='truncate text-[10px] font-semibold'>Needs approval</span>
    </div>
    <div className='bg-illustration border-border/50 space-y-2 border-t p-3'>
      <div className='space-y-1.5'>
        <div className='bg-foreground/15 h-1 w-full rounded-full' />
        <div className='bg-foreground/15 h-1 w-2/3 rounded-full opacity-70' />
      </div>
      <div className='flex gap-1.5'>
        <span className='flex flex-1 items-center justify-center gap-1 rounded-md bg-foreground py-1 text-[9px] font-semibold text-background'>
          <Check className='size-2.5' />
          Approve
        </span>
        <span className='ring-foreground/15 text-muted-foreground flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-[9px] font-semibold ring-1'>
          <X className='size-2.5' />
          Deny
        </span>
      </div>
    </div>
  </div>
)

/**
 * Desktop: full-width horizontal flow, absolutely-positioned nodes over a stretched SVG so the
 * rails line up with the HTML at any container width.
 *
 *   servers (left:0)  →  logo (50%)  →  tool call (70%)  →  outcomes (right:0)
 */
const DesktopFlow = () => (
  <div
    aria-hidden
    className='relative mx-auto w-full max-w-5xl'
    style={{ aspectRatio: '1000 / 360' }}>
    <svg
      viewBox='0 0 1000 360'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      preserveAspectRatio='none'
      className='absolute inset-0 size-full'>
      {/* Static dashed guide rails — servers into the logo */}
      <path
        d='M 175 60 C 340 60, 340 180, 470 180'
        stroke='currentColor'
        strokeLinecap='round'
        strokeDasharray='2 5'
        className='text-foreground/15'
      />
      <path
        d='M 175 180 H 470'
        stroke='currentColor'
        strokeLinecap='round'
        strokeDasharray='2 5'
        className='text-foreground/15'
      />
      <path
        d='M 175 300 C 340 300, 340 180, 470 180'
        stroke='currentColor'
        strokeLinecap='round'
        strokeDasharray='2 5'
        className='text-foreground/15'
      />

      {/* Logo → tool call main rail */}
      <path
        d='M 535 180 H 640'
        stroke='currentColor'
        strokeLinecap='round'
        className='text-foreground/15'
      />

      {/* Tool call → outcomes */}
      <path
        d='M 780 180 C 870 180, 870 80, 980 80'
        stroke='currentColor'
        strokeLinecap='round'
        strokeDasharray='2 5'
        className='text-foreground/15'
      />
      <path
        d='M 780 180 C 870 180, 870 280, 980 280'
        stroke='currentColor'
        strokeLinecap='round'
        strokeDasharray='2 5'
        className='text-foreground/15'
      />

      {/* Animated overlays — servers → logo */}
      <motion.path
        d='M 175 60 C 340 60, 340 180, 470 180'
        stroke='url(#mcpBeam1)'
        strokeLinecap='round'
        strokeWidth={1.5}
        strokeDasharray='0.25 0.75'
        pathLength='1'
        initial={{ strokeDashoffset: 0 }}
        animate={{ strokeDashoffset: -1 }}
        transition={{ duration: 2.4, ease: 'linear', delay: 0, repeat: Infinity }}
      />
      <motion.path
        d='M 175 180 H 470'
        stroke='url(#mcpBeam2)'
        strokeLinecap='round'
        strokeWidth={1.5}
        strokeDasharray='0.25 0.75'
        pathLength='1'
        initial={{ strokeDashoffset: 0 }}
        animate={{ strokeDashoffset: -1 }}
        transition={{ duration: 2.4, ease: 'linear', delay: 0.4, repeat: Infinity }}
      />
      <motion.path
        d='M 175 300 C 340 300, 340 180, 470 180'
        stroke='url(#mcpBeam3)'
        strokeLinecap='round'
        strokeWidth={1.5}
        strokeDasharray='0.25 0.75'
        pathLength='1'
        initial={{ strokeDashoffset: 0 }}
        animate={{ strokeDashoffset: -1 }}
        transition={{ duration: 2.4, ease: 'linear', delay: 0.8, repeat: Infinity }}
      />

      {/* Logo → tool call */}
      <motion.path
        d='M 535 180 H 640'
        stroke='var(--color-foreground)'
        strokeLinecap='round'
        strokeWidth={1.5}
        strokeDasharray='0.3 0.7'
        pathLength='1'
        initial={{ strokeDashoffset: 0 }}
        animate={{ strokeDashoffset: -1 }}
        transition={{ duration: 1.8, ease: 'linear', repeat: Infinity }}
      />

      {/* Tool call → outcomes */}
      <motion.path
        d='M 780 180 C 870 180, 870 80, 980 80'
        stroke='url(#mcpAutoRun)'
        strokeLinecap='round'
        strokeWidth={1.5}
        strokeDasharray='0.25 0.75'
        pathLength='1'
        initial={{ strokeDashoffset: 0 }}
        animate={{ strokeDashoffset: -1 }}
        transition={{ duration: 2.4, ease: 'linear', delay: 1.0, repeat: Infinity }}
      />
      <motion.path
        d='M 780 180 C 870 180, 870 280, 980 280'
        stroke='url(#mcpApproval)'
        strokeLinecap='round'
        strokeWidth={1.5}
        strokeDasharray='0.25 0.75'
        pathLength='1'
        initial={{ strokeDashoffset: 0 }}
        animate={{ strokeDashoffset: -1 }}
        transition={{ duration: 2.4, ease: 'linear', delay: 1.2, repeat: Infinity }}
      />

      <defs>
        <linearGradient
          id='mcpBeam1'
          x1='175'
          y1='60'
          x2='470'
          y2='180'
          gradientUnits='userSpaceOnUse'>
          <stop offset='0%' stopColor='#5E6AD2' stopOpacity={0} />
          <stop offset='100%' stopColor='#5E6AD2' />
        </linearGradient>
        <linearGradient
          id='mcpBeam2'
          x1='175'
          y1='180'
          x2='470'
          y2='180'
          gradientUnits='userSpaceOnUse'>
          <stop offset='0%' stopColor='#95BF47' stopOpacity={0} />
          <stop offset='100%' stopColor='#95BF47' />
        </linearGradient>
        <linearGradient
          id='mcpBeam3'
          x1='175'
          y1='300'
          x2='470'
          y2='180'
          gradientUnits='userSpaceOnUse'>
          <stop offset='0%' stopColor='#635BFF' stopOpacity={0} />
          <stop offset='100%' stopColor='#635BFF' />
        </linearGradient>
        <linearGradient
          id='mcpAutoRun'
          x1='780'
          y1='180'
          x2='980'
          y2='80'
          gradientUnits='userSpaceOnUse'>
          <stop offset='0%' stopColor='var(--color-emerald-400)' stopOpacity={0} />
          <stop offset='100%' stopColor='var(--color-emerald-400)' />
        </linearGradient>
        <linearGradient
          id='mcpApproval'
          x1='780'
          y1='180'
          x2='980'
          y2='280'
          gradientUnits='userSpaceOnUse'>
          <stop offset='0%' stopColor='var(--color-amber-400)' stopOpacity={0} />
          <stop offset='100%' stopColor='var(--color-amber-400)' />
        </linearGradient>
      </defs>
    </svg>

    {/* Servers — pinned left, aligned to viewBox y=60/180/300 */}
    <div className='absolute left-0 top-[16.6%] -translate-y-1/2'>
      <ServerCard server={servers[0]!} />
    </div>
    <div className='absolute left-0 top-1/2 -translate-y-1/2'>
      <ServerCard server={servers[1]!} />
    </div>
    <div className='absolute left-0 top-[83.3%] -translate-y-1/2'>
      <ServerCard server={servers[2]!} />
    </div>

    {/* Logo — center */}
    <div className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'>
      <Logo className='size-14 shadow-xl shadow-black/20 rounded-full' />
    </div>

    {/* Tool call — viewBox x=700 */}
    <div className='absolute left-[70%] top-1/2 -translate-x-1/2 -translate-y-1/2'>
      <ToolCallCard />
    </div>

    {/* Outcomes — pinned right, aligned to viewBox y=80 / y=280 */}
    <div className='absolute right-0 top-[22.2%] -translate-y-1/2'>
      <AutoRunCard />
    </div>
    <div className='absolute right-0 top-[77.7%] -translate-y-1/2'>
      <ApprovalCard />
    </div>
  </div>
)

/** Mobile: the same node order rotated 90°. */
const VerticalSCurve = ({
  fromX,
  toX,
  delay = 0,
  width = 240,
  height = 48,
}: {
  fromX: number
  toX: number
  delay?: number
  width?: number
  height?: number
}) => {
  const path = `M ${fromX} 0 C ${fromX} ${height / 2}, ${toX} ${height / 2}, ${toX} ${height}`
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className='text-foreground/15'>
      <path
        d={path}
        stroke='currentColor'
        strokeLinecap='round'
        strokeDasharray='2 5'
        fill='none'
      />
      <motion.path
        d={path}
        pathLength='1'
        stroke='var(--color-foreground)'
        strokeLinecap='round'
        strokeDasharray='0.2 2'
        fill='none'
        initial={{ strokeDashoffset: 1.2 }}
        animate={{ strokeDashoffset: -1 }}
        transition={{ duration: 1.6, ease: 'easeOut', delay, repeat: Infinity }}
      />
    </svg>
  )
}

const MobileFlow = () => (
  <div aria-hidden className='flex flex-col items-center'>
    <div className='flex items-start justify-center gap-3'>
      {servers.map((server) => (
        <ServerCard key={server.name} server={server} compact />
      ))}
    </div>

    {/* 3 S-curves merging into the logo */}
    <div className='flex w-full max-w-xs justify-center'>
      <svg aria-hidden viewBox='0 0 240 80' width='240' height='80' className='text-foreground/15'>
        <path
          d='M 40 0 C 40 40, 120 40, 120 80'
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray='2 5'
          fill='none'
        />
        <path
          d='M 120 0 V 80'
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray='2 5'
          fill='none'
        />
        <path
          d='M 200 0 C 200 40, 120 40, 120 80'
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray='2 5'
          fill='none'
        />
        <motion.path
          d='M 40 0 C 40 40, 120 40, 120 80'
          stroke='#5E6AD2'
          strokeLinecap='round'
          strokeDasharray='0.2 2'
          pathLength='1'
          fill='none'
          initial={{ strokeDashoffset: 1.2 }}
          animate={{ strokeDashoffset: -1 }}
          transition={{ duration: 1.6, ease: 'easeOut', delay: 0, repeat: Infinity }}
        />
        <motion.path
          d='M 120 0 V 80'
          stroke='#95BF47'
          strokeLinecap='round'
          strokeDasharray='0.2 2'
          pathLength='1'
          fill='none'
          initial={{ strokeDashoffset: 1.2 }}
          animate={{ strokeDashoffset: -1 }}
          transition={{ duration: 1.6, ease: 'easeOut', delay: 0.25, repeat: Infinity }}
        />
        <motion.path
          d='M 200 0 C 200 40, 120 40, 120 80'
          stroke='#635BFF'
          strokeLinecap='round'
          strokeDasharray='0.2 2'
          pathLength='1'
          fill='none'
          initial={{ strokeDashoffset: 1.2 }}
          animate={{ strokeDashoffset: -1 }}
          transition={{ duration: 1.6, ease: 'easeOut', delay: 0.5, repeat: Infinity }}
        />
      </svg>
    </div>

    <Logo className='size-14 shadow-xl shadow-black/20 rounded-full' />

    <VerticalSCurve fromX={120} toX={120} delay={0.3} />

    <ToolCallCard />

    {/* 2 S-curves diverging out to the two outcomes */}
    <div className='flex w-full max-w-xs justify-center'>
      <svg aria-hidden viewBox='0 0 240 80' width='240' height='80' className='text-foreground/15'>
        <path
          d='M 120 0 C 120 40, 60 40, 60 80'
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray='2 5'
          fill='none'
        />
        <path
          d='M 120 0 C 120 40, 180 40, 180 80'
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray='2 5'
          fill='none'
        />
        <motion.path
          d='M 120 0 C 120 40, 60 40, 60 80'
          stroke='var(--color-emerald-400)'
          strokeLinecap='round'
          strokeDasharray='0.2 2'
          pathLength='1'
          fill='none'
          initial={{ strokeDashoffset: 1.2 }}
          animate={{ strokeDashoffset: -1 }}
          transition={{ duration: 1.6, ease: 'easeOut', delay: 0.6, repeat: Infinity }}
        />
        <motion.path
          d='M 120 0 C 120 40, 180 40, 180 80'
          stroke='var(--color-amber-400)'
          strokeLinecap='round'
          strokeDasharray='0.2 2'
          pathLength='1'
          fill='none'
          initial={{ strokeDashoffset: 1.2 }}
          animate={{ strokeDashoffset: -1 }}
          transition={{ duration: 1.6, ease: 'easeOut', delay: 0.8, repeat: Infinity }}
        />
      </svg>
    </div>

    <div className='flex flex-wrap items-start justify-center gap-3'>
      <AutoRunCard />
      <ApprovalCard />
    </div>
  </div>
)

export const McpFlowIllustration = () => (
  <>
    <div className='hidden md:block'>
      <DesktopFlow />
    </div>
    <div className='md:hidden'>
      <MobileFlow />
    </div>
  </>
)

export default McpFlowIllustration
