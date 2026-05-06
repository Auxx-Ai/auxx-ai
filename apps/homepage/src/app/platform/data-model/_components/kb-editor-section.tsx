// apps/homepage/src/app/platform/data-model/_components/kb-editor-section.tsx

import { SectionBottomFade } from '~/app/_components/main/section-bottom-fade'
import { SectionTopFade } from '~/app/_components/main/section-top-fade'
import { ShaderGradientBg } from '~/app/_components/shader-gradient-bg'
import { AutoplayVideo } from '~/components/autoplay-video'
import { videoUrl } from '~/lib/cdn'

/**
 * KbEditorSection showcases the knowledge base editor: rich content blocks
 * and the draft → publish flow. Lives directly under KnowledgeBaseSection
 * on the data-model page.
 */
export default function KbEditorSection() {
  return (
    <section className='relative overflow-hidden bg-background border-foreground/10'>
      <ShaderGradientBg preset='hero' palette='aurora' uniforms={{ timeSpeed: 0.7 }} />
      <SectionTopFade fromColor='var(--color-background)' />
      <SectionBottomFade toColor='color-mix(in oklab, var(--color-muted) 25%, var(--color-background))' />
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3 bg-background/20'>
        <div className='border-x bg-background/20'>
          <div className='bg-muted/25 py-16 md:py-24'>
            <div className='mx-auto max-w-4xl space-y-12 px-6'>
              <h2 className='text-muted-foreground text-balance text-4xl font-semibold md:w-2/3'>
                Author rich articles in a{' '}
                <strong className='text-foreground font-semibold'>block-based editor</strong>
              </h2>
              <div className='bg-background ring-foreground/5 overflow-hidden rounded-xl border border-transparent shadow ring-1'>
                <AutoplayVideo
                  autoPlay
                  loop
                  muted
                  className='h-full w-full object-cover'
                  src={videoUrl('kb-editor-tutorial.mp4')}
                />
              </div>
              <div className='grid gap-6 md:grid-cols-2 md:gap-12'>
                <p className='text-muted-foreground'>
                  Compose with{' '}
                  <strong className='text-foreground font-semibold'>
                    tables, tabs, accordions, cards, callouts, code, and internal links
                  </strong>
                  . Drop in any block, nest them, and structure long articles without leaving the
                  editor — every block round-trips cleanly to Markdown.
                </p>

                <p className='text-muted-foreground'>
                  Save drafts, then{' '}
                  <strong className='text-foreground font-semibold'>publish in one click</strong> to
                  your portal and AI grounding at the same time. Version history keeps every
                  revision so you can roll back instantly when an edit doesn't land.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
