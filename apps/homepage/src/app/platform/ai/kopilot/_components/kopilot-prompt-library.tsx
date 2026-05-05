// apps/homepage/src/app/platform/ai/kopilot/_components/kopilot-prompt-library.tsx

const prompts = [
  { name: 'Daily inbox brief', description: 'Start the day with a summary of replies you owe.' },
  { name: 'Recap last conversation', description: 'Get a structured recap of any thread.' },
  { name: 'Draft refund reply', description: 'Pull policy and order context into a draft.' },
  { name: 'Tag tickets by intent', description: 'Auto-categorize incoming tickets.' },
  { name: 'Find similar past tickets', description: 'Surface prior solutions instantly.' },
  { name: 'Update contact from email', description: 'Extract role, company, and details.' },
  { name: 'Negative-feedback summary', description: 'Cluster complaints across this week.' },
  { name: 'Onboarding handoff brief', description: 'Hand off context to your CSM team.' },
  { name: 'Coach me on this reply', description: 'Get suggestions to improve tone and clarity.' },
  { name: 'Find KB gaps', description: 'Spot questions your KB doesn’t answer yet.' },
  { name: 'Account research', description: 'Run a quick brief on a company.' },
  { name: 'Suggest next step', description: 'Turn a thread into a follow-up task.' },
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

      <div className='relative pb-24 [--marquee:60s]'>
        <div className='pointer-events-none absolute inset-y-0 left-0 z-10 w-32 bg-gradient-to-r from-background via-background to-transparent' />
        <div className='pointer-events-none absolute inset-y-0 right-0 z-10 w-32 bg-gradient-to-l from-background via-background to-transparent' />

        <ul className='flex w-max gap-3 animate-[marquee_var(--marquee)_linear_infinite] hover:[animation-play-state:paused]'>
          {row.map((prompt, i) => (
            <li
              key={i}
              className='w-72 shrink-0 rounded-xl border border-foreground/10 bg-background p-4 text-left'>
              <div className='text-foreground text-sm font-medium'>{prompt.name}</div>
              <p className='text-muted-foreground mt-1 text-xs'>{prompt.description}</p>
              <div className='text-muted-foreground/60 mt-3 text-[10px] uppercase tracking-wide'>
                Auxx
              </div>
            </li>
          ))}
        </ul>

        <ul className='mt-3 flex w-max gap-3 animate-[marquee-reverse_var(--marquee)_linear_infinite] hover:[animation-play-state:paused]'>
          {row.map((prompt, i) => (
            <li
              key={i}
              className='w-72 shrink-0 rounded-xl border border-foreground/10 bg-background p-4 text-left'>
              <div className='text-foreground text-sm font-medium'>{prompt.name}</div>
              <p className='text-muted-foreground mt-1 text-xs'>{prompt.description}</p>
              <div className='text-muted-foreground/60 mt-3 text-[10px] uppercase tracking-wide'>
                Auxx
              </div>
            </li>
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
