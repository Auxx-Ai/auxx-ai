// apps/homepage/src/app/platform/ai/kopilot/_components/kopilot-prompt-library.tsx

import {
  ArrowRightLeft,
  BookOpen,
  Building2,
  FileQuestion,
  FileText,
  Frown,
  Inbox,
  Lightbulb,
  type LucideIcon,
  MessagesSquare,
  Search,
  Tag,
  Users,
} from 'lucide-react'
import { cn } from '~/lib/utils'
import { ENTITY_COLOR_CLASS, type EntityColor } from '../../_mocks'

interface Prompt {
  name: string
  description: string
  icon: LucideIcon
  color: EntityColor
}

const prompts: Prompt[] = [
  {
    name: 'Daily inbox brief',
    description: 'Start the day with a summary of replies you owe.',
    icon: Inbox,
    color: 'orange',
  },
  {
    name: 'Recap last conversation',
    description: 'Get a structured recap of any thread.',
    icon: MessagesSquare,
    color: 'blue',
  },
  {
    name: 'Draft refund reply',
    description: 'Pull policy and order context into a draft.',
    icon: FileText,
    color: 'amber',
  },
  {
    name: 'Tag tickets by intent',
    description: 'Auto-categorize incoming tickets.',
    icon: Tag,
    color: 'orange',
  },
  {
    name: 'Find similar past tickets',
    description: 'Surface prior solutions instantly.',
    icon: Search,
    color: 'pink',
  },
  {
    name: 'Update contact from email',
    description: 'Extract role, company, and details.',
    icon: Users,
    color: 'blue',
  },
  {
    name: 'Negative-feedback summary',
    description: 'Cluster complaints across this week.',
    icon: Frown,
    color: 'red',
  },
  {
    name: 'Onboarding handoff brief',
    description: 'Hand off context to your CSM team.',
    icon: ArrowRightLeft,
    color: 'green',
  },
  {
    name: 'Coach me on this reply',
    description: 'Get suggestions to improve tone and clarity.',
    icon: BookOpen,
    color: 'teal',
  },
  {
    name: 'Find KB gaps',
    description: 'Spot questions your KB doesn’t answer yet.',
    icon: FileQuestion,
    color: 'indigo',
  },
  {
    name: 'Account research',
    description: 'Run a quick brief on a company.',
    icon: Building2,
    color: 'purple',
  },
  {
    name: 'Suggest next step',
    description: 'Turn a thread into a follow-up task.',
    icon: Lightbulb,
    color: 'amber',
  },
]

const row = [...prompts, ...prompts]

export default function KopilotPromptLibrary() {
  return (
    <section className='relative bg-muted/25 border-b border-foreground/10 overflow-hidden'>
      <div className='mx-auto max-w-6xl px-6 py-24 text-center'>
        <h2 className='mx-auto max-w-2xl text-balance text-4xl font-semibold md:text-5xl'>
          From one expert to everyone.
        </h2>
        <p className='text-muted-foreground mx-auto mt-4 max-w-xl'>
          Best practice becomes standard practice with the prompt library.
        </p>
      </div>

      <div className='relative pt-3 pb-24 [--marquee:60s] [mask-image:linear-gradient(to_right,transparent,black_8rem,black_calc(100%-8rem),transparent)]'>
        <ul className='flex w-max gap-3 animate-[marquee_var(--marquee)_linear_infinite] hover:[animation-play-state:paused]'>
          {row.map((prompt, i) => (
            <PromptCard key={i} prompt={prompt} />
          ))}
        </ul>

        <ul className='mt-3 flex w-max gap-3 animate-[marquee-reverse_var(--marquee)_linear_infinite] hover:[animation-play-state:paused]'>
          {row.map((prompt, i) => (
            <PromptCard key={i} prompt={prompt} />
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

function PromptCard({ prompt }: { prompt: Prompt }) {
  const Icon = prompt.icon
  return (
    <li className='bg-card/75 ring-border-illustration shadow-black/6.5 w-72 shrink-0 rounded-2xl p-4 text-left shadow-lg ring-1'>
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-md',
          ENTITY_COLOR_CLASS[prompt.color]
        )}>
        <Icon className='size-3.5' />
      </span>
      <div className='text-foreground mt-3 text-sm font-medium'>{prompt.name}</div>
      <p className='text-muted-foreground mt-1 text-xs'>{prompt.description}</p>
      <div className='text-muted-foreground/60 mt-3 text-[10px] uppercase tracking-wide'>Auxx</div>
    </li>
  )
}
