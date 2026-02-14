// apps/web/src/app/(website)/_components/features-3-cols/index.tsx
// import { HumanNodeCard } from './human-node-card'
// import { ActionsCard } from './actions-card'
// import { TriggersCard } from './triggers-card'

import { ChartIllustration } from './chart-illustration'
import { ResultIllustration } from './result-illustration'

// Features3Cols renders the three feature highlight cards with shared framing.
export default function Reporting2Cols() {
  return (
    <section id='ai-responses' className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className=' @container py-24'>
            <div className='relative z-30 mx-auto max-w-5xl px-6 text-center'>
              <h1 className='mx-auto max-w-3xl text-balance text-3xl font-semibold sm:text-4xl'>
                <span className='text-muted-foreground'>Real-time data.</span> Dynamic reporting.
              </h1>

              <p className='text-muted-foreground mx-auto mb-10 mt-3 max-w-xl text-balance text-xl'>
                Generate comprehensive workflow reports instantly to gain deeper insights into your
                automation performance with Auxx.ai's advanced analytics suite.
              </p>
            </div>

            <div className='mx-auto max-w-5xl px-6'>
              <div className='ring-foreground/10 @4xl:grid-cols-2 @max-4xl:divide-y @4xl:divide-x relative grid overflow-hidden rounded-2xl border border-transparent bg-zinc-50 shadow-md shadow-black/5 ring-1'>
                <div className='row-span-2 grid grid-rows-subgrid gap-8'>
                  <div className='px-8 pt-8'>
                    <h3 className='text-balance font-semibold'>Analytics for Workflows</h3>
                    <p className='text-muted-foreground mt-3'>
                      Monitor workflow performance with detailed analytics, execution metrics, and
                      insights to optimize your automation processes.
                    </p>
                  </div>
                  <div className='self-end pb-4'>
                    <ChartIllustration />
                  </div>
                </div>
                <div className='row-span-2 grid grid-rows-subgrid gap-8'>
                  <div className='relative z-10 px-8 pt-8'>
                    <h3 className='text-balance font-semibold'>Workflow Execution Results</h3>
                    <p className='text-muted-foreground mt-3'>
                      View detailed execution results, success rates, error logs, and output data
                      from your workflow runs with comprehensive reporting.
                    </p>
                  </div>
                  <div className='self-end px-8 pb-8'>
                    <ResultIllustration />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
