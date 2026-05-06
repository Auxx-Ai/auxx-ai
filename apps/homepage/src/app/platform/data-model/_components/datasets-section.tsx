// apps/homepage/src/app/platform/data-model/_components/datasets-section.tsx

import { FileCode, Files, FileText, FileType, type LucideIcon } from 'lucide-react'
import { cn } from '~/lib/utils'
import { ENTITY_COLOR_CLASS, type EntityColor } from '../../ai/_mocks'

const grainSvg =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.5'/></svg>"

interface Dataset {
  name: string
  description: string
  format: 'PDF' | 'DOCX' | 'HTML' | 'TXT'
  icon: LucideIcon
  color: EntityColor
}

const datasets: Dataset[] = [
  {
    name: 'Refund policy',
    description: 'Authoritative rules for refund eligibility.',
    format: 'PDF',
    icon: FileText,
    color: 'orange',
  },
  {
    name: 'Shipping FAQ',
    description: 'Carrier coverage, transit times, and tracking.',
    format: 'DOCX',
    icon: Files,
    color: 'blue',
  },
  {
    name: 'Help center articles',
    description: 'Public docs synced from your website.',
    format: 'HTML',
    icon: FileCode,
    color: 'indigo',
  },
  {
    name: 'Onboarding guide',
    description: 'How new customers get up and running.',
    format: 'PDF',
    icon: FileText,
    color: 'amber',
  },
  {
    name: 'Return process',
    description: 'Step-by-step playbook for RMAs.',
    format: 'DOCX',
    icon: Files,
    color: 'teal',
  },
  {
    name: 'Product catalog',
    description: 'Specs, SKUs, and feature breakdowns.',
    format: 'HTML',
    icon: FileCode,
    color: 'green',
  },
  {
    name: 'Warranty terms',
    description: 'Coverage, exclusions, and claim windows.',
    format: 'PDF',
    icon: FileText,
    color: 'purple',
  },
  {
    name: 'Support playbook',
    description: 'House style for tone, escalation, handoffs.',
    format: 'DOCX',
    icon: Files,
    color: 'pink',
  },
  {
    name: 'API reference',
    description: 'Endpoints, parameters, and example payloads.',
    format: 'HTML',
    icon: FileCode,
    color: 'red',
  },
  {
    name: 'Meeting transcripts',
    description: 'Internal calls and standups.',
    format: 'TXT',
    icon: FileType,
    color: 'gray',
  },
  {
    name: 'Brand guidelines',
    description: 'Voice, vocabulary, and forbidden phrases.',
    format: 'PDF',
    icon: FileText,
    color: 'indigo',
  },
  {
    name: 'Internal wiki',
    description: 'Notes and runbooks exported as plain text.',
    format: 'TXT',
    icon: FileType,
    color: 'teal',
  },
]

const row = [...datasets, ...datasets]

type FormatTone = 'red' | 'blue' | 'emerald' | 'purple'

interface FormatSource {
  name: string
  description: string
  icon: LucideIcon
  tone: FormatTone
}

const formatSources: FormatSource[] = [
  { name: 'PDF', description: 'Manuals, contracts, scanned docs.', icon: FileText, tone: 'red' },
  { name: 'DOCX', description: 'Word and Google Docs exports.', icon: Files, tone: 'blue' },
  {
    name: 'HTML',
    description: 'Saved web pages and articles.',
    icon: FileCode,
    tone: 'emerald',
  },
  {
    name: 'Plain text',
    description: 'TXT, transcripts, notes.',
    icon: FileType,
    tone: 'purple',
  },
]

const FORMAT_TONE_CLASSES: Record<FormatTone, string> = {
  red: 'bg-red-100 dark:bg-red-500/10 to-rose-100 dark:to-rose-500/10 hover:bg-red-50 dark:hover:bg-red-500/15',
  blue: 'bg-blue-100 dark:bg-blue-500/10 to-sky-100 dark:to-sky-500/10 hover:bg-blue-50 dark:hover:bg-blue-500/15',
  emerald:
    'bg-emerald-100 dark:bg-emerald-500/10 to-sky-100 dark:to-sky-500/10 hover:bg-emerald-50 dark:hover:bg-emerald-500/15',
  purple:
    'bg-purple-100 dark:bg-purple-500/10 to-fuchsia-100 dark:to-fuchsia-500/10 hover:bg-purple-50 dark:hover:bg-purple-500/15',
}

const FORMAT_ICON_CLASSES: Record<FormatTone, string> = {
  red: 'text-red-600 dark:text-red-400',
  blue: 'text-blue-600 dark:text-blue-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  purple: 'text-purple-600 dark:text-purple-400',
}

export default function DatasetsSection() {
  return (
    <section
      id='datasets'
      className='relative bg-muted/25 border-b border-foreground/10 overflow-hidden scroll-mt-24'>
      <div className='mx-auto max-w-6xl px-6 pt-24 pb-12 text-center'>
        <h2 className='mx-auto max-w-2xl text-balance text-4xl font-semibold md:text-5xl'>
          Bring your own docs. We make them searchable.
        </h2>
        <p className='text-muted-foreground mx-auto mt-4 max-w-xl'>
          Drop in PDFs, exports, and pages. Auxx extracts, segments, and embeds them — ready for
          Kopilot and ticket AI to cite within minutes.
        </p>
      </div>

      <div className='mx-auto max-w-4xl px-6 pb-12'>
        <ul className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
          {formatSources.map((source) => (
            <FormatCard key={source.name} source={source} />
          ))}
        </ul>
      </div>

      <div className='relative pt-3 pb-24 [--marquee:60s] [mask-image:linear-gradient(to_right,transparent,black_8rem,black_calc(100%-8rem),transparent)]'>
        <ul className='flex w-max gap-3 animate-[marquee_var(--marquee)_linear_infinite] hover:[animation-play-state:paused]'>
          {row.map((dataset, i) => (
            <DatasetCard key={i} dataset={dataset} />
          ))}
        </ul>

        <ul className='mt-3 flex w-max gap-3 animate-[marquee-reverse_var(--marquee)_linear_infinite] hover:[animation-play-state:paused]'>
          {row.map((dataset, i) => (
            <DatasetCard key={i} dataset={dataset} />
          ))}
        </ul>
      </div>

      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes marquee-reverse {
          from { transform: translateX(-50%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </section>
  )
}

function FormatCard({ source }: { source: FormatSource }) {
  const Icon = source.icon
  return (
    <li
      className={cn(
        'bg-linear-to-b inset-ring-foreground/10 inset-ring-1 ring-foreground/[0.04] ring-offset-background from-white dark:from-background via-white/50 dark:via-background/50 relative grid overflow-hidden rounded-xl p-4 ring-1 ring-offset-2 transition-colors duration-200',
        FORMAT_TONE_CLASSES[source.tone]
      )}>
      <Icon className={cn('relative z-10 size-6', FORMAT_ICON_CLASSES[source.tone])} />
      <div className='relative z-10 mt-6 space-y-0.5'>
        <div className='text-foreground text-sm font-medium'>{source.name}</div>
        <p className='text-foreground/60 text-xs'>{source.description}</p>
      </div>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 mix-blend-overlay'
        style={{ backgroundImage: `url("${grainSvg}")`, backgroundSize: '160px 160px' }}
      />
    </li>
  )
}

function DatasetCard({ dataset }: { dataset: Dataset }) {
  const Icon = dataset.icon
  return (
    <li className='bg-card/75 ring-border-illustration shadow-black/6.5 w-72 shrink-0 rounded-2xl p-4 text-left shadow-lg ring-1'>
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-md',
          ENTITY_COLOR_CLASS[dataset.color]
        )}>
        <Icon className='size-3.5' />
      </span>
      <div className='text-foreground mt-3 text-sm font-medium'>{dataset.name}</div>
      <p className='text-muted-foreground mt-1 text-xs'>{dataset.description}</p>
      <div className='text-muted-foreground/60 mt-3 text-[10px] uppercase tracking-wide'>
        {dataset.format}
      </div>
    </li>
  )
}
