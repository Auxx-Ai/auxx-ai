// apps/homepage/src/app/platform/integration/_components/integration-ai-center-section.tsx

import { GRADIENT_PALETTES } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import { AutoplayVideo } from '~/components/autoplay-video'
import { videoUrl } from '~/lib/cdn'

/**
 * IntegrationAiCenterSection component displays AI provider integrations
 * with description of multi-provider support and flexibility
 */
export default function IntegrationAiCenterSection() {
  return (
    <section className='relative overflow-hidden bg-background border-foreground/10 border-b'>
      <RandomGradient colors={[...GRADIENT_PALETTES.twilight]} mode='mesh' animated />
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3 bg-background/20'>
        <div className='border-x bg-background/20'>
          <div className='bg-muted/25 py-16 md:py-24'>
            <div className='mx-auto max-w-4xl space-y-12 px-6'>
              <h2 className='text-muted-foreground text-balance text-4xl font-semibold md:w-2/3'>
                Choose from{' '}
                <strong className='text-foreground font-semibold'>leading AI providers</strong>
              </h2>
              <div className='bg-background ring-foreground/5 overflow-hidden rounded-xl border border-transparent shadow ring-1'>
                <AutoplayVideo
                  autoPlay
                  loop
                  muted
                  className='h-full w-full object-cover'
                  src={videoUrl('ai-model-choose.mp4')}
                />
              </div>
              <div className='grid gap-6 md:grid-cols-2 md:gap-12'>
                <p className='text-muted-foreground'>
                  Connect with{' '}
                  <strong className='text-foreground font-semibold'>
                    OpenAI, Anthropic, Google, and more
                  </strong>
                  . Switch between models or use different providers for different workflows—GPT-4
                  for complex reasoning, Claude for nuanced conversations, or Gemini for multimodal
                  tasks.
                </p>

                <p className='text-muted-foreground'>
                  <strong className='text-foreground font-semibold'>Bring your own API keys</strong>{' '}
                  for full control over costs and usage, or use our managed AI service for instant
                  setup. Configure temperature, max tokens, and model parameters per workflow for
                  optimal results.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
