import {
  GRADIENT_PALETTE_MODES,
  GRADIENT_PALETTES,
  type GradientPaletteName,
} from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import {
  Brain,
  Calendar,
  Clock,
  Code,
  Database,
  FileJson,
  GitBranch,
  Globe,
  List,
  Mail,
  Octagon,
  Play,
  Repeat,
  Search,
  Send,
  StickyNote,
  Tags,
  UserCheck,
  Variable,
  Webhook,
} from 'lucide-react'
import type * as React from 'react'
import { cn } from '~/lib/utils'

const nodes: Array<{
  title: string
  description: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  nodeType: string
  iconColor: string
  gradient?: GradientPaletteName
}> = [
  {
    title: 'Webhook',
    description: 'Trigger workflow via HTTP webhook',
    icon: Webhook,
    nodeType: 'webhook',
    iconColor: 'fill-blue-200',
    gradient: 'aurora',
  },
  {
    title: 'Note',
    description: 'Add notes and documentation to your workflow',
    icon: StickyNote,
    nodeType: 'note',
    iconColor: 'fill-yellow-200',
  },
  {
    title: 'Date Time',
    description: 'Perform various date and time operations',
    icon: Calendar,
    nodeType: 'date-time',
    iconColor: 'fill-green-200',
    gradient: 'ocean',
  },
  {
    title: 'Wait',
    description: 'Pause workflow execution for a specified duration',
    icon: Clock,
    nodeType: 'wait',
    iconColor: 'fill-orange-200',
  },
  {
    title: 'Send Message',
    description: 'Deliver a reply to the customer through any connected channel',
    icon: Send,
    nodeType: 'answer',
    iconColor: 'fill-emerald-200',
    gradient: 'candy',
  },
  {
    title: 'Assign Variable',
    description: 'Create custom variables for use in subsequent nodes',
    icon: Variable,
    nodeType: 'var-assign',
    iconColor: 'fill-purple-200',
  },
  {
    title: 'Message Received',
    description: 'Triggers when a new message is received',
    icon: Mail,
    nodeType: 'message-received',
    iconColor: 'fill-cyan-200',
    gradient: 'ocean',
  },
  {
    title: 'Information Extractor',
    description: 'Extract structured information from text using AI with custom schemas',
    icon: FileJson,
    nodeType: 'information-extractor',
    iconColor: 'fill-indigo-200',
  },
  {
    title: 'Code',
    description: 'Execute custom code to transform data',
    icon: Code,
    nodeType: 'code',
    iconColor: 'text-slate-500',
    gradient: 'aurora',
  },
  {
    title: 'Text Classifier',
    description: 'Classify text into predefined categories using AI',
    icon: Tags,
    nodeType: 'text-classifier',
    iconColor: 'fill-pink-200',
  },
  {
    title: 'End',
    description: 'End workflow execution',
    icon: Octagon,
    nodeType: 'end',
    iconColor: 'fill-red-200',
    gradient: 'sunset',
  },
  {
    title: 'Manual Trigger',
    description: 'Manually trigger workflow with user inputs',
    icon: Play,
    nodeType: 'manual',
    iconColor: 'fill-teal-200',
  },
  {
    title: 'HTTP Request',
    description: 'Make HTTP requests to external APIs',
    icon: Globe,
    nodeType: 'http',
    iconColor: 'fill-sky-200',
    gradient: 'aurora',
  },
  {
    title: 'AI',
    description: 'AI-powered text generation and processing',
    icon: Brain,
    nodeType: 'ai',
    iconColor: 'fill-violet-200',
  },
  {
    title: 'List Operations',
    description: 'Perform operations on arrays: filter, sort, map, reduce, and more',
    icon: List,
    nodeType: 'list',
    iconColor: 'fill-amber-200',
    gradient: 'dusk',
  },
  {
    title: 'CRUD',
    description: 'Create, update, or delete records in the database',
    icon: Database,
    nodeType: 'crud',
    iconColor: 'fill-lime-200',
  },
  {
    title: 'Find',
    description: 'Search for records with dynamic filters and sorting',
    icon: Search,
    nodeType: 'find',
    iconColor: 'fill-rose-200',
    gradient: 'ocean',
  },
  {
    title: 'IF/ELSE',
    description: 'Branch workflow based on conditions',
    icon: GitBranch,
    nodeType: 'if-else',
    iconColor: 'fill-fuchsia-200',
  },
  {
    title: 'Scheduled Trigger',
    description: 'Trigger workflow on a schedule',
    icon: Clock,
    nodeType: 'scheduled',
    iconColor: 'fill-orange-200',
    gradient: 'dusk',
  },
  {
    title: 'Human Review',
    description: 'Pause workflow and wait for human approval',
    icon: UserCheck,
    nodeType: 'human',
    iconColor: 'fill-emerald-200',
  },
  {
    title: 'Loop',
    description: 'Iterate over each item in a list',
    icon: Repeat,
    nodeType: 'loop',
    iconColor: 'text-blue-500',
    gradient: 'pastel',
  },
]

export default function NodesSection() {
  return (
    <section id='ai-responses' className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='bg-muted/50 @container py-24'>
            <div className='mx-auto mb-12 max-w-xl text-center'>
              <h2 className='text-balance text-3xl font-semibold md:text-4xl'>
                Build with <span className='text-muted-foreground'>powerful</span> blocks.
              </h2>
              <p className='text-muted-foreground mb-6 mt-4 text-balance'>
                Build powerful automation workflows with our comprehensive collection of nodes for
                every use case.
              </p>
            </div>

            <div className='mx-auto max-w-5xl px-6'>
              <div className='relative'>
                <PlusDecorator className='-translate-[calc(50%-0.5px)]' />
                <PlusDecorator className='right-0 -translate-y-[calc(50%-0.5px)] translate-x-[calc(50%-0.5px)]' />
                <PlusDecorator className='bottom-0 right-0 translate-x-[calc(50%-0.5px)] translate-y-[calc(50%-0.5px)]' />
                <PlusDecorator className='bottom-0 -translate-x-[calc(50%-0.5px)] translate-y-[calc(50%-0.5px)]' />
                <div className='@md:grid-cols-2 @2xl:grid-cols-3 grid border overflow-hidden'>
                  {nodes.map((node) => (
                    <NodeCard
                      key={node.nodeType}
                      title={node.title}
                      description={node.description}
                      icon={<node.icon size={16} className={node.iconColor} />}
                      gradient={node.gradient}
                    />
                  ))}
                </div>
              </div>
              <div className='text-center max-w-lg mx-auto mt-10 mb-0'>
                <p className='text-muted-foreground text-balance max-w-5xl'>
                  ...and many more nodes available
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const NodeCard = ({
  title,
  description,
  icon,
  gradient,
}: {
  title: string
  description: string
  icon: React.ReactNode
  gradient?: GradientPaletteName
}) => {
  const isLight = gradient && GRADIENT_PALETTE_MODES[gradient] === 'light'
  return (
    <div className='hover:z-10 relative p-6 border-r border-b -mr-px -mb-px transition-all overflow-hidden'>
      {gradient && (
        <RandomGradient
          colors={[...GRADIENT_PALETTES[gradient]]}
          mode='hero'
          className='rounded-2xl m-3'
        />
      )}
      <div
        className={cn(
          'relative z-10 ring-border-illustration/20 flex size-8 items-center justify-center rounded-md shadow ring-1',
          isLight ? 'bg-white/70' : 'bg-card/70'
        )}>
        {icon}
      </div>

      <div className='relative z-10 space-y-2 pt-6'>
        <h3 className={cn('text-base font-medium', isLight && 'text-zinc-900')}>{title}</h3>
        <p className={cn('line-clamp-2', isLight ? 'text-zinc-700' : 'text-muted-foreground')}>
          {description}
        </p>
      </div>
    </div>
  )
}

const PlusDecorator = ({ className }: { className?: string }) => (
  <div
    aria-hidden
    className={cn(
      'mask-radial-from-15% before:bg-foreground/25 after:bg-foreground/25 absolute size-3 before:absolute before:inset-0 before:m-auto before:h-px after:absolute after:inset-0 after:m-auto after:w-px',
      className
    )}
  />
)
