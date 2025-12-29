// apps/web/src/app/(website)/_components/features-3-cols/performance-analytics-card.tsx
import { SquareChevronRight, SquareTerminal } from 'lucide-react'
import { ActionIllustration } from './action-illustration'

// ActionsCard renders the analytics feature column.
export const ActionsCard = () => (
  <div className="bg-card ring-foreground/10 grid grid-rows-[auto_1fr] space-y-12 overflow-hidden rounded-2xl border border-transparent shadow-md shadow-black/5 ring-1">
    <div>
      <SquareTerminal className="fill-foreground/10 mb-5 size-4" />
      <h3 className="text-foreground text-lg font-semibold">Actions</h3>
      <p className="text-muted-foreground mt-3">
        Get precise by <span className="text-foreground font-medium">customizing</span> every
        actionable step of your process. .
      </p>
    </div>
    <div className="bg-linear-to-b -m-8 flex flex-col items-end justify-center from-transparent via-purple-50 to-emerald-50 p-8">
      <div className="mt-6 w-full px-2">
        <ActionIllustration />
      </div>
    </div>
  </div>
)
