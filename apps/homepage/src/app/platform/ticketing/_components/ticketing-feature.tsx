import { TicketPaperIllustration } from './ticket-paper-illustration'
import { TicketStatsIllustration } from './ticket-stats-illustration'
import { Zap, Settings, TrendingUp, Users } from 'lucide-react'

export default function TicketingFeature() {
  return (
    <section className="relative border-foreground/10 border-b">
      <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <div className="bg-muted/50 py-24">
            <div className="mx-auto w-full max-w-5xl px-6">
              <div className="grid max-md:divide-y md:grid-cols-2 md:divide-x">
                <div className="row-span-2 grid grid-rows-subgrid gap-8 pb-12 md:pr-12">
                  <div>
                    <h3 className="text-foreground text-xl font-semibold">
                      Fast and Intuitive
                    </h3>
                    <p className="text-muted-foreground mt-4 text-lg">
                      An easy-to-use interface helps your agents handle complex support tickets fast, together as a team.
                    </p>
                  </div>
                  <TicketPaperIllustration />
                </div>
                <div className="row-span-2 grid grid-rows-subgrid gap-8 pb-12 max-md:pt-12 md:pl-12">
                  <div>
                    <h3 className="text-foreground text-xl font-semibold">Smart Performance Insights</h3>
                    <p className="text-muted-foreground mt-4 text-lg">
                      See how to improve with out-of-the-box ticketing metrics on team performance and customer satisfaction.
                    </p>
                  </div>
                  <TicketStatsIllustration />
                </div>
              </div>
              <div className="relative grid grid-cols-2 gap-x-3 gap-y-6 border-t pt-12 sm:gap-6 lg:grid-cols-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Zap className="text-foreground size-4" />
                    <h3 className="text-sm font-medium">Fast and Intuitive</h3>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    An easy-to-use interface helps your agents handle complex support tickets fast, together as a team.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Settings className="text-foreground size-4" />
                    <h3 className="text-sm font-medium">Flexible for Your Processes</h3>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Skip the rigid, legacy ticketing systems. Front organizes your workflow and reduces unnecessary clicks.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="text-foreground size-4" />
                    <h3 className="text-sm font-medium">Smart Performance Insights</h3>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    See how to improve with out-of-the-box ticketing metrics on team performance and customer satisfaction.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Users className="text-foreground size-4" />
                    <h3 className="text-sm font-medium">Team Collaboration</h3>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Enable seamless collaboration between agents with shared ticket views, internal notes, and assignment workflows.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
