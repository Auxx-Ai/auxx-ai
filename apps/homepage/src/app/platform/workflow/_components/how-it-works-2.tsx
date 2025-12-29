import { ChartIllustration } from './chart-illustration'
import { GanttChartIllustration } from './gantt-chart-illustration'
import { LayoutIllustration } from './layout-illustration'
import { cn } from '~/lib/utils'
import { avatars } from '~/app/_components/avatars'

export default function HowItWorksTwo() {
  return (
    <section className="border-foreground/10 relative  border-b">
      <div className="mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <section className="bg-background overflow-hidden">
            <div className="bg-muted/50 py-24">
              <div className="relative mx-auto max-w-5xl space-y-2 pr-6 md:px-6">
                <div className="mb-32 max-w-xl space-y-4 max-md:pl-6">
                  <h2 className="text-foreground text-balance text-3xl font-semibold">
                    Set up your pipeline in minutes with Quartz analytics platform
                  </h2>
                  <p className="text-muted-foreground text-balance text-lg">
                    Our powerful analytics platform helps you visualize complex data, identify
                    trends, and make data-driven decisions with confidence.
                  </p>
                </div>

                <div className="flex gap-4 max-md:pl-4 sm:gap-8 md:gap-16 lg:gap-24">
                  <LineGroup>
                    <StepNumber>1</StepNumber>
                    <Line nodePosition="bottom" nodeSide="right" />
                  </LineGroup>
                  <div className="w-full pb-32">
                    <div className="relative z-10 max-w-xl space-y-3">
                      <h3 className="text-foreground text-balance text-xl font-semibold">
                        Transform your data into visual insights
                      </h3>
                      <p className="text-muted-foreground text-balance md:text-lg">
                        Transform raw data into actionable insights with our intuitive visualization
                        tools. Create beautiful charts and graphs that make complex information easy
                        to understand and share.
                      </p>

                      <div className="mt-12 flex gap-12">
                        <div className="space-y-1">
                          <div className="text-foreground text-4xl font-bold">90+</div>
                          <p className="text-muted-foreground text-sm">Integrations</p>
                        </div>
                        <div className="space-y-1">
                          <div className="text-foreground text-4xl font-bold">56%</div>
                          <p className="text-muted-foreground text-sm">Productivity Boost</p>
                        </div>
                      </div>
                    </div>

                    <div className="-mt-24" aria-hidden>
                      <ChartIllustration />
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 max-md:pl-4 sm:gap-8 md:gap-16 lg:gap-24">
                  <LineGroup>
                    <StepNumber>2</StepNumber>
                    <Line nodePosition="bottom" nodeSide="right" />
                  </LineGroup>
                  <div className="w-[calc(100%-3rem)] pb-32 md:w-[calc(100%-8rem)]">
                    <div className="max-w-xl space-y-3">
                      <h3 className="text-foreground text-balance text-xl font-semibold">
                        Manage your projects efficiently
                      </h3>
                      <p className="text-muted-foreground text-balance md:text-lg">
                        Plan, track, and manage your projects with our comprehensive Gantt chart
                        system. Visualize timelines, allocate resources, and keep your team aligned
                        on project milestones.
                      </p>
                    </div>

                    <div className="mt-16" aria-hidden>
                      <GanttChartIllustration />
                    </div>

                    <blockquote className="before:bg-primary relative mt-12 max-w-xl pl-4 before:absolute before:inset-y-0 before:left-0 before:w-1 before:rounded-full">
                      <p>
                        It's the perfect fusion of simplicity and versatility, enabling us to create
                        UIs that are as stunning as they are user-friendly.
                      </p>

                      <div className="mt-6 flex items-center gap-2">
                        <div className="bg-background size-6 rounded-full border p-0.5 shadow shadow-zinc-950/5">
                          <img
                            className="aspect-square rounded-full object-cover"
                            src={avatars.zach}
                            alt="Zach"
                            height="460"
                            width="460"
                          />
                        </div>
                        <span>Zachery Melton</span>
                        <span className="text-muted-foreground">@zach</span>
                      </div>
                    </blockquote>
                  </div>
                </div>

                <div className="flex gap-4 max-md:pl-4 sm:gap-8 md:gap-16 lg:gap-24">
                  <LineGroup>
                    <StepNumber>3</StepNumber>
                    <Line nodePosition="top" isLast />
                  </LineGroup>
                  <div className="w-[calc(100%-3rem)] md:w-[calc(100%-8rem)]">
                    <div className="relative z-10 max-w-xl space-y-3">
                      <h3 className="text-foreground text-balance text-xl font-semibold">
                        Create your perfect workspace layout
                      </h3>
                      <p className="text-muted-foreground text-balance md:text-lg">
                        Design your ideal analytics dashboard with our flexible layout options.
                        Arrange components, resize panels, and create personalized views that match
                        your specific workflow needs.
                      </p>
                    </div>

                    <div className="mt-16" aria-hidden>
                      <LayoutIllustration />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}

const StepNumber = ({ children }: { children: React.ReactNode }) => {
  return (
    <span className="bg-background ring-foreground/10 text-foreground relative flex size-6 items-center justify-center rounded-full border border-transparent font-mono text-xs font-medium shadow ring-1">
      {children}
    </span>
  )
}

interface ProgressLineProps {
  isLast?: boolean
  nodePosition?: 'top' | 'bottom' | 'center'
  nodeSide?: 'left' | 'right'
}

interface NodeProps {
  position?: 'top' | 'bottom' | 'center'
  side?: 'left' | 'right'
}

const LineNode = ({ position = 'top', side = 'left' }: NodeProps) => {
  return (
    <div
      className={cn('absolute inset-x-0 h-40', {
        'top-20': position === 'top',
        'bottom-20': position === 'bottom',
        'inset-y-0 my-auto': position === 'center',
        'translate-x-[0.5px] -scale-x-100': side === 'right',
      })}>
      <div
        className={cn(
          'absolute left-0 top-0 h-40 w-1/2 -translate-x-2 rounded-l-full border-y border-l',
          {
            'border-background': side === 'right',
          }
        )}>
        <div
          className={cn('size-full rounded-l-full border-y border-l', {
            'border-background': side === 'left',
          })}
        />
      </div>
      <div
        className={cn(
          'absolute -bottom-2 right-1/2 size-2.5 translate-x-px rounded-tr-full border-r border-t',
          {
            'border-background': side === 'left',
          }
        )}>
        <div
          className={cn('size-full rounded-tr-full border-r border-t', {
            'border-background': side === 'right',
          })}
        />
      </div>
      <div
        className={cn(
          'absolute -top-[7px] right-1/2 size-[9px] translate-x-px rounded-br-full border-b border-r',
          {
            'border-background': side === 'left',
          }
        )}>
        <div
          className={cn('size-full rounded-br-full border-b border-r', {
            'border-background': side === 'right',
          })}
        />
      </div>
    </div>
  )
}

const Line = ({ isLast, nodePosition = 'top', nodeSide = 'left' }: ProgressLineProps) => {
  return (
    <div className="relative" aria-hidden>
      <div
        className={cn(
          'bg-border border-background absolute inset-x-0 top-2 mx-auto w-0.5 border-r',
          {
            'h-[calc(4rem+0.75px)]': nodePosition === 'top',
            'bottom-[calc(50%+5.45rem)]': nodePosition === 'center',
            'bottom-[15.45rem]': nodePosition === 'bottom',
          }
        )}
      />

      <div
        className={cn(
          'bg-border border-background absolute inset-x-0 bottom-0 mx-auto w-0.5 border-r',
          isLast && 'mask-b-from-35%',
          {
            'top-[15.5rem]': nodePosition === 'top',
            'top-[calc(50%+5.5rem)]': nodePosition === 'center',
            'h-[4.5rem]': nodePosition === 'bottom',
          }
        )}
      />

      <LineNode position={nodePosition} side={nodeSide} />
    </div>
  )
}

const LineGroup = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="relative grid w-7 grid-rows-[auto_1fr] [--color-border:color-mix(in_oklab,var(--color-foreground)10%,var(--color-background))]">
      {children}
    </div>
  )
}
