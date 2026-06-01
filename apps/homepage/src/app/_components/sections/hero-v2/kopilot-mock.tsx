// apps/homepage/src/app/_components/sections/hero-v2/kopilot-mock.tsx
'use client'

import { Sparkles } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import {
  MockAppSidebar,
  MockBrowserChrome,
  MockKopilotHeader,
  MockKopilotWindow,
  MockMainPage,
  MockPanelFrame,
} from '~/app/platform/ai/_mocks'
import { KOPILOT_HERO_SCRIPT } from '~/app/platform/ai/kopilot/_components/kopilot-hero-script'
import { cn } from '~/lib/utils'
import { AgentLog } from './agent-log'

// ---------------------------------------------------------------------------
// Shared classes — tweak in one place. Most layers use the same tilt /
// perspective / anchor / canvas width, so we name them here and compose with cn.
// ---------------------------------------------------------------------------

// 3D tilt applied identically to chrome, sidebar, panel, agent-log, and bubble.
// Disabled on mobile — flat layout reads better at small widths.
const TILT = 'md:rotate-x-[30deg] md:rotate-y-[24deg] md:rotate-[344deg]'

// Perspective for the tilted stage. Disabled on mobile (no tilt → no perspective).
const PERSPECTIVE = 'md:perspective-[4000px]'

// Outer anchor — every desktop-mock layer drops in from off-screen and lands
// pinned to bottom-right of the hero area on desktop. On mobile we anchor to
// the top-right (and shift the scale origin) so the scaled-down canvas sits
// flush with the top of the column instead of sticking to the bottom edge.
const STAGE_ANCHOR = cn(
  'absolute right-[-22vw] transform-3d',
  '-top-4 origin-top-right md:top-auto md:bottom-[-6vh] md:origin-bottom-right',
  'scale-[0.45] sm:scale-[0.6] md:scale-[0.85] lg:scale-100'
)

// Tilted, masked inner stage that sits inside STAGE_ANCHOR.
const TILT_STAGE = cn('relative', TILT, PERSPECTIVE, 'transform-3d')

// Same as TILT_STAGE but with the radial mask used on the chrome + sidebar layers.
// Mask only applies on md+ where the tilt makes the off-screen fade meaningful.
const TILT_STAGE_MASKED = cn(
  TILT_STAGE,
  'md:mask-radial-from-65% md:mask-radial-at-top-right md:mask-radial-[200%_100%]'
)

// Fixed-width canvas every desktop layer is sized against. Inner offsets
// (top:50, left:20, top:[180px], etc.) are pixel-pinned to this width.
const MOCK_CANVAS = 'relative w-[1100px] max-w-none transform-3d'

// Floating-card layers (agent-log + prompt bubble) share an identical wrapper.
const FLOAT_ANCHOR = cn(
  'absolute z-10 transform-3d',
  PERSPECTIVE,
  'origin-top-right scale-[0.55] sm:scale-[0.7] md:scale-90 lg:scale-100'
)

// Drop-in animation used by every layer; only `delay` and optional `z` change.
const DROP_TRANSITION = { duration: 2, ease: [0.16, 1, 0.3, 1] as const }
const dropIn = (reduce: boolean | null, delay: number, z?: number) => ({
  initial: reduce ? false : { opacity: 0, y: -300, ...(z !== undefined && { z }) },
  animate: { opacity: 1, y: 0, ...(z !== undefined && { z }) },
  transition: { ...DROP_TRANSITION, delay },
})

export function KopilotMock() {
  const reduce = useReducedMotion()

  const float = (delay: number, amplitude = 6) =>
    reduce
      ? {}
      : {
          animate: { y: [0, -amplitude, 0] },
          transition: { duration: 7, repeat: Infinity, ease: 'easeInOut' as const, delay },
        }

  return (
    <div className='pointer-events-none relative h-full min-h-[60vh] w-full select-none transform-3d md:min-h-[80vh]'>
      {/* Back layer — chrome shell ONLY. Sidebar + kopilot header are rendered as
          independent root-level siblings below so each can drop in true screen-Y
          with its own stagger. Chrome's interior is a sized placeholder with the
          sidebar/main-page background colors so the shell reads correctly while
          the other layers are still off-screen mid-animation. */}
      <motion.div {...dropIn(reduce, 0)} className={cn(STAGE_ANCHOR, 'z-0')}>
        <div className={TILT_STAGE_MASKED}>
          <motion.div className={MOCK_CANVAS}>
            <MockBrowserChrome variant='regular'>
              <div className='flex h-[620px] bg-mock-page-bg'>
                {/* Transparent sidebar spacer — sidebar is rendered as an independent
                    sibling, but MockMainPage (and the kopilot header inside it) must
                    still be offset by the sidebar width so the header lines up with
                    where the sidebar lands. Hidden on mobile since the sidebar
                    itself is hidden below md. */}
                <div className='hidden w-[220px] shrink-0 md:block' />
                <MockMainPage
                  noPanelFrame
                  header={
                    <MockKopilotHeader
                      breadcrumb={{
                        trail: ['Chats'],
                        title: 'Open Support Tickets Summary',
                        titleMobile: 'Tickets',
                      }}
                    />
                  }>
                  <div className='h-full w-full' />
                </MockMainPage>
              </div>
            </MockBrowserChrome>
          </motion.div>
        </div>
      </motion.div>

      {/* Sidebar — INDEPENDENT root-level sibling. Y motion on the OUTER motion.div
          (before the tilt) gives a true screen-Y drop. Matched outer wrappers + tilt
          + perspective + width align with the chrome layer. */}
      <motion.div {...dropIn(reduce, 0.5)} className={cn(STAGE_ANCHOR, 'z-0')}>
        <div className={TILT_STAGE_MASKED}>
          <motion.div className={MOCK_CANVAS}>
            <div className='relative h-[680px] w-full transform-3d'>
              <div
                className='absolute flex transform-3d'
                style={{
                  top: 50,
                  left: 20,
                  width: 220,
                  bottom: 10,
                  transform: 'translateZ(60px)',
                }}>
                <div className='hidden h-full w-full overflow-hidden rounded-2xl shadow-2xl shadow-black/30 md:flex'>
                  <MockAppSidebar activeKey='kopilot' className='hidden h-full w-full md:flex' />
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Panel frame — INDEPENDENT root-level sibling with its own perspective + tilt.
          Y motion is applied to the OUTER motion.div BEFORE the rotation, so the drop
          is in true screen-Y (not tilted local-Y). Inside the matching tilt, panel is
          absolutely positioned at the chrome interior offsets. */}
      <motion.div {...dropIn(reduce, 1)} className={cn(STAGE_ANCHOR, 'z-[1]')}>
        <motion.div {...float(2.4, 24)} className='transform-3d'>
          <div className={TILT_STAGE}>
            <motion.div className={MOCK_CANVAS}>
              {/* Mirrors the chrome's outer size so the panel can position inside
                its main-page interior. Height matches chrome: header(~50) + 620. */}
              <div className='relative h-[680px] w-full transform-3d'>
                {/* Width is calc(100% − sidebar − chrome padding) so the panel fills
                  the main-page area exactly: full chrome interior on mobile (no
                  sidebar), full minus the 220px sidebar on desktop.
                  29 = 8 (chrome p-2 left) + 21 (right offset).
                  249 = 228 (chrome p-2 + sidebar) + 21. */}
                <div
                  className='absolute top-[180px] left-[8px] bottom-[21px] flex w-[calc(100%_-_29px)] transform-3d md:left-[228px] md:w-[calc(100%_-_320px)]'
                  style={{ transform: 'translateZ(120px)' }}>
                  <div className='flex h-full min-h-0 flex-1 flex-col rounded-2xl shadow-2xl shadow-black/40 transform-3d backdrop-blur-[2px]'>
                    <MockPanelFrame>
                      <MockKopilotWindow
                        script={KOPILOT_HERO_SCRIPT}
                        composerPlaceholder='Ask Kopilot...'
                        modelLabel='GPT-5.4 Nano'
                      />
                    </MockPanelFrame>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </motion.div>

      {/* Mid layer — AgentLog. Root-level sibling with its own perspective + tilt + float
          (breathing). Y drop on the outer motion.div (before tilt) for true screen-Y. */}
      <motion.div
        {...dropIn(reduce, 1.5, 340)}
        className={cn(FLOAT_ANCHOR, 'right-[18%] top-[18%] z-10 hidden md:block')}>
        <motion.div {...float(1.2)} className='transform-3d'>
          <div className={TILT}>
            <AgentLog />
          </div>
        </motion.div>
      </motion.div>

      {/* Front layer — Kopilot prompt bubble. Root-level sibling with its own
          perspective + tilt + float (breathing). Y drop on the outer motion.div
          for true screen-Y. */}
      <motion.div
        {...dropIn(reduce, 2, 440)}
        className={cn(FLOAT_ANCHOR, 'right-[10%] top-[8%] z-20 hidden md:block')}>
        <motion.div {...float(2.4)} className='transform-3d'>
          <div className={TILT}>
            <div className='w-[360px] max-w-full rounded-xl border border-foreground/10 bg-background/95 p-3.5 shadow-2xl shadow-black/25 backdrop-blur-md'>
              <div className='mb-2 flex items-center gap-2'>
                <div className='flex size-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-500 text-white'>
                  <Sparkles className='size-2.5' />
                </div>
                <span className='text-xs font-medium text-foreground'>Kopilot</span>
              </div>
              <p className='text-sm leading-relaxed text-foreground'>
                Reply to the open VIP tickets and tag anything about shipping delays.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
