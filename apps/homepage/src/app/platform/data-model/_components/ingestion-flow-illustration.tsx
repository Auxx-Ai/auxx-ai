// apps/homepage/src/app/platform/data-model/_components/ingestion-flow-illustration.tsx
'use client'

import { Database, FileText } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Logo } from '~/components/logo'
import { cn } from '~/lib/utils'

const CYCLE_DURATION = 1900

type DBProvider = {
  name: string
  color: string
  iconBackground: string
  beamColorFrom: string
  beamColorTo: string
}

const providers: DBProvider[] = [
  {
    name: 'pgvector',
    color: 'from-[#3ECF8E] to-[#249361]',
    iconBackground: 'bg-emerald-950',
    beamColorFrom: '#3ECF8E',
    beamColorTo: '#249361',
  },
  {
    name: 'Pinecone',
    color: 'from-[#5B8DEF] to-[#1B4DCB]',
    iconBackground: 'bg-blue-950',
    beamColorFrom: '#5B8DEF',
    beamColorTo: '#1B4DCB',
  },
  {
    name: 'Qdrant',
    color: 'from-[#DC382D] to-[#A41E11]',
    iconBackground: 'bg-red-950 dark:bg-red-950/50',
    beamColorFrom: '#DC382D',
    beamColorTo: '#A41E11',
  },
]

const DocumentDocxIllustration = () => (
  <div aria-hidden className='relative size-fit'>
    <div className='z-2 after:border-foreground/15 text-shadow-sm absolute -right-3 bottom-2 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-lg shadow-blue-900/25 after:absolute after:inset-0 after:rounded after:border'>
      DOC
    </div>
    <div className='bg-illustration ring-border-illustration z-1 shadow-black/6.5 relative w-16 space-y-3 rounded-md rounded-tr-[15%] p-3 shadow-md ring-1'>
      <div className='space-y-1.5'>
        <div className='bg-foreground/10 h-0.5 w-full rounded-full' />
        <div className='flex gap-1'>
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
        </div>
        <div className='flex gap-1'>
          <div className='bg-foreground/10 h-0.5 w-1/2 rounded-full' />
          <div className='bg-foreground/10 h-0.5 w-1/2 rounded-full' />
        </div>
        <div className='flex gap-1'>
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
          <div className='bg-foreground/10 h-0.5 w-2/3 rounded-full' />
        </div>
        <div className='flex gap-1'>
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
        </div>
      </div>
      <div className='flex gap-1 pt-1'>
        <div className='bg-foreground h-0.5 w-4 rounded-full' />
      </div>
    </div>
  </div>
)

const DocumentTxtIllustration = () => (
  <div aria-hidden className='relative size-fit'>
    <div className='z-2 after:border-foreground/15 text-shadow-sm absolute -right-3 bottom-2 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-black shadow-lg shadow-amber-800/25 after:absolute after:inset-0 after:rounded after:border'>
      TXT
    </div>
    <div className='bg-illustration ring-border-illustration z-1 shadow-black/6.5 w-18 relative space-y-2.5 rounded-md rounded-tr-[15%] px-3 pb-3 pt-3 shadow-md ring-1'>
      <div className='space-y-[5px]'>
        <div className='bg-foreground/15 h-[0.5px] w-10 -rotate-[0.5deg] rounded-full' />
        <div className='bg-foreground/15 h-[0.5px] w-8 translate-x-px rotate-[0.3deg] rounded-full' />
        <div className='bg-foreground/15 h-[0.5px] w-10 -rotate-[0.3deg] rounded-full' />
        <div className='bg-foreground/15 h-[0.5px] w-6 translate-x-px rotate-[0.2deg] rounded-full' />
        <div className='bg-foreground/15 h-[0.5px] w-9 -rotate-[0.4deg] rounded-full' />
        <div className='bg-foreground/15 h-[0.5px] w-full translate-x-0.5 rotate-[0.5deg] rounded-full' />
        <div className='bg-foreground/15 h-[0.5px] w-9 -rotate-[0.4deg] rounded-full' />
        <div className='bg-foreground/15 h-[0.5px] w-8 translate-x-0.5 rotate-[0.5deg] rounded-full' />
      </div>
      <div className='bg-foreground/30 h-[0.5px] w-5 -rotate-[0.3deg] rounded-full' />
    </div>
  </div>
)

const DocumentPdfIllustration = () => (
  <div aria-hidden className='relative size-fit'>
    <div className='z-2 after:border-foreground/15 text-shadow-sm absolute -right-3 bottom-2 rounded bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-lg shadow-rose-900/25 after:absolute after:inset-0 after:rounded after:border'>
      PDF
    </div>
    <div className='bg-illustration ring-border-illustration z-1 shadow-black/6.5 relative w-16 space-y-3 rounded-md rounded-tr-[15%] p-3 shadow-md ring-1'>
      <div className='space-y-1.5'>
        <div className='bg-foreground/10 h-0.5 w-full rounded-full' />
        <div className='flex gap-1'>
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
        </div>
        <div className='flex gap-1'>
          <div className='bg-foreground/10 h-0.5 w-1/2 rounded-full' />
          <div className='bg-foreground/10 h-0.5 w-1/2 rounded-full' />
        </div>
        <div className='flex gap-1'>
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
        </div>
        <div className='flex gap-1'>
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
          <div className='bg-foreground/10 h-0.5 w-2/3 rounded-full' />
          <div className='bg-foreground/10 h-0.5 w-1/3 rounded-full' />
        </div>
      </div>
      <div className='flex gap-1 pt-1'>
        <div className='bg-foreground h-0.5 w-4 rounded-full' />
      </div>
    </div>
  </div>
)

type SnippetCardProps = {
  filename: string
  similarity: string
  accent: string
  lines: { width: string; opacity?: number }[]
}

const SnippetCard = ({ filename, similarity, accent, lines }: SnippetCardProps) => (
  <div className='bg-card/75 ring-border-illustration shadow-black/6.5 w-40 overflow-hidden rounded-xl shadow-md ring-1'>
    <div className='flex items-center gap-1.5 px-3 py-1.5'>
      <FileText className={cn('size-3', accent)} />
      <span className='truncate text-[10px] font-semibold'>{filename}</span>
    </div>
    <div className='bg-illustration border-border/50 space-y-1.5 border-t p-3'>
      {lines.map((line, i) => (
        <div
          key={i}
          className='bg-foreground/15 h-1 rounded-full'
          style={{ width: line.width, opacity: line.opacity ?? 1 }}
        />
      ))}
      <div className='flex items-center justify-between pt-1'>
        <span className='text-muted-foreground text-[9px]'>similarity</span>
        <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-semibold', accent)}>
          {similarity}
        </span>
      </div>
    </div>
  </div>
)

const snippetA = {
  filename: 'refund-policy.md',
  similarity: '0.92',
  accent: 'text-emerald-500',
  lines: [
    { width: '100%' },
    { width: '85%' },
    { width: '70%', opacity: 0.7 },
    { width: '60%', opacity: 0.7 },
  ],
}

const snippetB = {
  filename: 'shipping-faq.md',
  similarity: '0.87',
  accent: 'text-violet-500',
  lines: [
    { width: '90%' },
    { width: '75%' },
    { width: '95%', opacity: 0.7 },
    { width: '50%', opacity: 0.7 },
  ],
}

const ProviderCard = ({ vertical = false }: { vertical?: boolean }) => {
  const [activeProvider, setActiveProvider] = useState(0)
  const [containerWidth, setContainerWidth] = useState<string>('auto')
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveProvider((prev) => (prev + 1) % providers.length)
    }, CYCLE_DURATION)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const updateWidth = () => {
      if (contentRef.current) {
        setContainerWidth(`${contentRef.current.offsetWidth}px`)
      }
    }
    updateWidth()
    const timer = setTimeout(updateWidth, 100)
    return () => clearTimeout(timer)
  }, [activeProvider])

  const currentProvider = useMemo(() => providers[activeProvider]!, [activeProvider])

  return (
    <div className={cn('relative', vertical ? 'mx-auto w-fit' : 'w-fit')}>
      <div className='relative mx-auto w-fit'>
        <div className='absolute inset-0 opacity-50 dark:opacity-15'>
          <div
            className={cn(
              'absolute inset-1 animate-pulse rounded-xl bg-gradient-to-r blur-md',
              currentProvider.color
            )}
          />
        </div>
        <motion.div
          animate={{ width: containerWidth }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className='ring-foreground/15 shadow-black/6.5 from-card to-card/50 bg-radial relative overflow-hidden rounded-xl shadow-md ring-1 backdrop-blur'>
          <div className='relative'>
            <div
              ref={contentRef}
              className='invisible absolute flex items-center gap-2 whitespace-nowrap py-2 pl-2 pr-3'>
              <div className='size-8 shrink-0' />
              <div>
                <div className='text-xs font-semibold'>{currentProvider.name}</div>
                <div className='text-foreground/65 text-[10px]'>VectorDB</div>
              </div>
            </div>
            <AnimatePresence initial={false} mode='popLayout'>
              <motion.div
                key={activeProvider}
                initial={{ opacity: 0, scale: 0.9, filter: 'blur(12px)', y: -56 }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0)', y: 0 }}
                exit={{ opacity: 0, scale: 0.9, filter: 'blur(12px)', y: 56 }}
                transition={{ duration: 0.5, type: 'spring', bounce: 0.2 }}
                className='flex items-center gap-2 py-2 pl-2 pr-3'>
                <div
                  className={cn(
                    'inset-ring-1 dark:inset-ring-foreground/15 inset-ring-foreground/50 flex size-8 shrink-0 items-center justify-center rounded-lg',
                    currentProvider.iconBackground
                  )}>
                  <Database className='size-4 text-white' />
                </div>
                <div>
                  <div className='text-xs font-semibold'>{currentProvider.name}</div>
                  <div className='text-foreground/65 text-[10px]'>VectorDB</div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

/**
 * Desktop: full-width horizontal flow.
 * Layout uses absolute positioning so the SVG paths align precisely with the
 * HTML elements regardless of container width.
 *
 *   docs (left:0)  →  logo (50%)  →  DB (72%)  →  snippets (right:0)
 *
 * SVG viewBox: 0 0 1000 360, preserveAspectRatio="none" so paths stretch with the container.
 */
const DesktopFlow = () => {
  return (
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
        {/* Static dashed guide rails — 3 S-curves from documents to logo */}
        <path
          d='M 100 60 C 300 60, 300 180, 500 180'
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray='2 5'
          className='text-foreground/15'
        />
        <path
          d='M 100 180 H 500'
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray='2 5'
          className='text-foreground/15'
        />
        <path
          d='M 100 300 C 300 300, 300 180, 500 180'
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray='2 5'
          className='text-foreground/15'
        />

        {/* Logo → DB main rail */}
        <path
          d='M 540 180 H 700'
          stroke='currentColor'
          strokeLinecap='round'
          className='text-foreground/15'
        />

        {/* DB → snippets — S-curves out */}
        <path
          d='M 800 180 C 880 180, 880 80, 980 80'
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray='2 5'
          className='text-foreground/15'
        />
        <path
          d='M 800 180 C 880 180, 880 280, 980 280'
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray='2 5'
          className='text-foreground/15'
        />

        {/* Animated overlays — documents → logo. dasharray period (=1) matches
            pathLength so the strokeDashoffset 0 → -1 loop is perfectly seamless. */}
        <motion.path
          d='M 100 60 C 300 60, 300 180, 500 180'
          stroke='url(#docColor1)'
          strokeLinecap='round'
          strokeWidth={1.5}
          strokeDasharray='0.25 0.75'
          pathLength='1'
          initial={{ strokeDashoffset: 0 }}
          animate={{ strokeDashoffset: -1 }}
          transition={{ duration: 2.4, ease: 'linear', delay: 0, repeat: Infinity }}
        />
        <motion.path
          d='M 100 180 H 500'
          stroke='url(#docColor2)'
          strokeLinecap='round'
          strokeWidth={1.5}
          strokeDasharray='0.25 0.75'
          pathLength='1'
          initial={{ strokeDashoffset: 0 }}
          animate={{ strokeDashoffset: -1 }}
          transition={{ duration: 2.4, ease: 'linear', delay: 0.4, repeat: Infinity }}
        />
        <motion.path
          d='M 100 300 C 300 300, 300 180, 500 180'
          stroke='url(#docColor3)'
          strokeLinecap='round'
          strokeWidth={1.5}
          strokeDasharray='0.25 0.75'
          pathLength='1'
          initial={{ strokeDashoffset: 0 }}
          animate={{ strokeDashoffset: -1 }}
          transition={{ duration: 2.4, ease: 'linear', delay: 0.8, repeat: Infinity }}
        />

        {/* Logo → DB animated overlay */}
        <motion.path
          d='M 540 180 H 700'
          stroke='var(--color-foreground)'
          strokeLinecap='round'
          strokeWidth={1.5}
          strokeDasharray='0.15 0.85'
          pathLength='1'
          initial={{ strokeDashoffset: 0 }}
          animate={{ strokeDashoffset: -1 }}
          transition={{ duration: 1.8, ease: 'linear', repeat: Infinity }}
        />

        {/* DB → snippet branches animated */}
        <motion.path
          d='M 800 180 C 880 180, 880 80, 980 80'
          stroke='url(#snippetColorA)'
          strokeLinecap='round'
          strokeWidth={1.5}
          strokeDasharray='0.25 0.75'
          pathLength='1'
          initial={{ strokeDashoffset: 0 }}
          animate={{ strokeDashoffset: -1 }}
          transition={{ duration: 2.4, ease: 'linear', delay: 1.0, repeat: Infinity }}
        />
        <motion.path
          d='M 800 180 C 880 180, 880 280, 980 280'
          stroke='url(#snippetColorB)'
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
            id='docColor1'
            x1='100'
            y1='60'
            x2='500'
            y2='180'
            gradientUnits='userSpaceOnUse'>
            <stop offset='0%' stopColor='#3B82F6' stopOpacity={0} />
            <stop offset='100%' stopColor='#3B82F6' />
          </linearGradient>
          <linearGradient
            id='docColor2'
            x1='100'
            y1='180'
            x2='500'
            y2='180'
            gradientUnits='userSpaceOnUse'>
            <stop offset='0%' stopColor='#F59E0B' stopOpacity={0} />
            <stop offset='100%' stopColor='#F59E0B' />
          </linearGradient>
          <linearGradient
            id='docColor3'
            x1='100'
            y1='300'
            x2='500'
            y2='180'
            gradientUnits='userSpaceOnUse'>
            <stop offset='0%' stopColor='#F43F5E' stopOpacity={0} />
            <stop offset='100%' stopColor='#F43F5E' />
          </linearGradient>
          <linearGradient
            id='snippetColorA'
            x1='800'
            y1='180'
            x2='980'
            y2='80'
            gradientUnits='userSpaceOnUse'>
            <stop offset='0%' stopColor='var(--color-emerald-400)' stopOpacity={0} />
            <stop offset='100%' stopColor='var(--color-emerald-400)' />
          </linearGradient>
          <linearGradient
            id='snippetColorB'
            x1='800'
            y1='180'
            x2='980'
            y2='280'
            gradientUnits='userSpaceOnUse'>
            <stop offset='0%' stopColor='var(--color-violet-400)' stopOpacity={0} />
            <stop offset='100%' stopColor='var(--color-violet-400)' />
          </linearGradient>
        </defs>
      </svg>

      {/* Documents — pinned left, three rows aligned to viewBox y=60/180/300 */}
      <div className='absolute left-0 top-[16.6%] -translate-y-1/2'>
        <DocumentDocxIllustration />
      </div>
      <div className='absolute left-0 top-1/2 -translate-y-1/2'>
        <DocumentTxtIllustration />
      </div>
      <div className='absolute left-0 top-[83.3%] -translate-y-1/2'>
        <DocumentPdfIllustration />
      </div>

      {/* Logo — center */}
      <div className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'>
        <Logo className='size-14 shadow-xl shadow-black/20 rounded-full' />
      </div>

      {/* DB Card — at viewBox x=750 (75% of width), y=180 */}
      <div className='absolute left-[72%] top-1/2 -translate-x-1/2 -translate-y-1/2'>
        <ProviderCard />
      </div>

      {/* Snippets — pinned right, two rows aligned to viewBox y=80 / y=280 */}
      <div className='absolute right-0 top-[22.2%] -translate-y-1/2'>
        <SnippetCard {...snippetA} />
      </div>
      <div className='absolute right-0 top-[77.7%] -translate-y-1/2'>
        <SnippetCard {...snippetB} />
      </div>
    </div>
  )
}

/**
 * Mobile: vertical S-curves flowing top → bottom.
 * Same node order as desktop, just rotated 90°.
 */
const VerticalSCurve = ({
  fromX,
  toX,
  delay = 0,
  width = 240,
  height = 60,
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

const MobileFlow = () => {
  return (
    <div aria-hidden className='flex flex-col items-center'>
      {/* Documents row */}
      <div className='flex items-center justify-center gap-6'>
        <DocumentDocxIllustration />
        <DocumentTxtIllustration />
        <DocumentPdfIllustration />
      </div>

      {/* 3 S-curves merging into the logo center */}
      <div className='flex w-full max-w-xs justify-center'>
        <svg
          aria-hidden
          viewBox='0 0 240 80'
          width='240'
          height='80'
          className='text-foreground/15'>
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
            stroke='var(--color-foreground)'
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
            stroke='var(--color-foreground)'
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
            stroke='var(--color-foreground)'
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

      {/* Logo */}
      <Logo className='size-14 shadow-xl shadow-black/20 rounded-full' />

      <VerticalSCurve fromX={120} toX={120} delay={0.3} width={240} height={48} />

      {/* DB card */}
      <ProviderCard vertical />

      {/* 2 S-curves diverging out to snippets */}
      <div className='flex w-full max-w-xs justify-center'>
        <svg
          aria-hidden
          viewBox='0 0 240 80'
          width='240'
          height='80'
          className='text-foreground/15'>
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
            stroke='var(--color-violet-400)'
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

      {/* Snippets row */}
      <div className='flex flex-wrap items-start justify-center gap-3'>
        <SnippetCard {...snippetA} />
        <SnippetCard {...snippetB} />
      </div>
    </div>
  )
}

export const IngestionFlowIllustration = () => {
  return (
    <>
      <div className='hidden md:block'>
        <DesktopFlow />
      </div>
      <div className='md:hidden'>
        <MobileFlow />
      </div>
    </>
  )
}

export default IngestionFlowIllustration
