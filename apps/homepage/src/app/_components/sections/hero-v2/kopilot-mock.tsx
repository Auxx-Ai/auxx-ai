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
import { AgentLog } from './agent-log'

export function KopilotMock() {
  const reduce = useReducedMotion()

  const float = (delay: number) =>
    reduce
      ? {}
      : {
          animate: { y: [0, -6, 0] },
          transition: { duration: 7, repeat: Infinity, ease: 'easeInOut', delay },
        }

  return (
    <div className='pointer-events-none relative h-full min-h-[80vh] w-full select-none transform-3d'>
      {/* Crosshatch mesh background — fades radially */}
      {/* <div
        aria-hidden
        className='pointer-events-none absolute inset-0 mask-radial-from-55% mask-radial-to-75% opacity-60'
        style={{
          backgroundImage: `
            repeating-linear-gradient(22.5deg, transparent, transparent 1px, rgba(120, 120, 140, 0.06) 1px, rgba(120, 120, 140, 0.06) 2px, transparent 2px, transparent 4px),
            repeating-linear-gradient(67.5deg, transparent, transparent 1px, rgba(120, 120, 140, 0.05) 1px, rgba(120, 120, 140, 0.05) 2px, transparent 2px, transparent 4px),
            repeating-linear-gradient(112.5deg, transparent, transparent 1px, rgba(120, 120, 140, 0.04) 1px, rgba(120, 120, 140, 0.04) 2px, transparent 2px, transparent 4px),
            repeating-linear-gradient(157.5deg, transparent, transparent 1px, rgba(120, 120, 140, 0.03) 1px, rgba(120, 120, 140, 0.03) 2px, transparent 2px, transparent 4px)
          `,
        }}
      /> */}

      {/* Back layer — chrome shell ONLY. Sidebar + kopilot header are rendered as
          independent root-level siblings below so each can drop in true screen-Y with
          its own stagger. Chrome's interior is a sized placeholder with the sidebar/
          main-page background colors so the shell reads correctly while the other
          layers are still off-screen mid-animation. */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -300 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1], delay: 0 }}
        className='absolute right-[-22vw] bottom-[-6vh] z-0 transform-3d'>
        <div className='relative rotate-x-[30deg] rotate-y-[24deg] rotate-[344deg] mask-radial-from-65% mask-radial-at-top-right mask-radial-[200%_100%] perspective-[4000px] transform-3d'>
          <motion.div className='relative w-[1100px] max-w-none transform-3d'>
            <MockBrowserChrome variant='regular'>
              <div className='flex h-[620px] bg-mock-page-bg'>
                {/* Transparent sidebar spacer — sidebar is rendered as an independent
                    sibling, but MockMainPage (and the kopilot header inside it) must
                    still be offset by the sidebar width so the header lines up with
                    where the sidebar lands. Hidden on mobile since the sidebar itself
                    is hidden below md. */}
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
          + perspective + width align with the chrome layer. Inside the matching tilt,
          MockAppSidebar is absolutely positioned at the chrome's sidebar slot. */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -300 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1], delay: 0.5 }}
        className='absolute right-[-22vw] bottom-[-6vh] z-0 transform-3d'>
        <div className='relative rotate-x-[30deg] rotate-y-[24deg] rotate-[344deg] perspective-[4000px] mask-radial-from-65% mask-radial-at-top-right mask-radial-[200%_100%]  transform-3d'>
          <motion.div className='relative w-[1100px] max-w-none transform-3d'>
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

      {/* Panel frame — INDEPENDENT root-level sibling with its own perspective + tilt + float.
          Y motion is applied to the OUTER motion.div BEFORE the rotation, so the drop is in
          true screen-Y (not tilted local-Y). Outer wrappers match the back-layer wrapper's
          positioning + tilt EXACTLY so the panel visually aligns with the chrome's main-page
          area. Inside the matching tilt, panel is absolutely positioned at the chrome interior
          offsets (top:62 left:241 right:21 bottom:21). */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -300 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1], delay: 1 }}
        className='absolute right-[-22vw] bottom-[-6vh] z-[1] transform-3d'>
        <div className='relative rotate-x-[30deg] rotate-y-[24deg] rotate-[344deg] perspective-[4000px] transform-3d'>
          <motion.div className='relative w-[1100px] max-w-none transform-3d'>
            {/* This div mirrors the chrome's outer size so the panel can position
                inside its main-page interior. Height matches chrome: header(~50) + 620. */}
            <div className='relative h-[680px] w-full transform-3d'>
              {/* Width is calc(100% − sidebar − chrome padding) so the panel fills the
                  main-page area exactly: full chrome interior on mobile (no sidebar),
                  full minus the 220px sidebar on desktop. 29 = 8 (chrome p-2 left) + 21
                  (right offset). 249 = 228 (chrome p-2 + sidebar) + 21. */}
              <div
                className='absolute top-[180px] left-[8px] bottom-[21px] flex w-[calc(100%_-_29px)] transform-3d md:left-[228px] md:w-[calc(100%_-_320px)]'
                style={{ transform: 'translateZ(120px)' }}>
                <div className='flex h-full min-h-0 flex-1 flex-col shadow-2xl shadow-black/40 transform-3d rounded-2xl'>
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

      {/* Mid layer — AgentLog. Root-level sibling with its own perspective + tilt + float
          (breathing). Y drop on the outer motion.div (before tilt) for true screen-Y. */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -300, z: 340 }}
        animate={{ opacity: 1, y: 0, z: 340 }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1], delay: 1.5 }}
        className='absolute right-[18%] top-[18%] z-10 perspective-[4000px] transform-3d '>
        <motion.div {...float(1.2)} className='transform-3d'>
          <div className='rotate-x-[30deg] rotate-y-[24deg] rotate-[344deg]'>
            <AgentLog />
          </div>
        </motion.div>
      </motion.div>

      {/* Front layer — Kopilot prompt bubble. Root-level sibling with its own perspective +
          tilt + float (breathing). Y drop on the outer motion.div for true screen-Y. */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -300, z: 440 }}
        animate={{ opacity: 1, y: 0, z: 440 }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1], delay: 2 }}
        className='absolute right-[10%] top-[8%] z-20 perspective-[4000px] transform-3d'>
        <motion.div {...float(2.4)} className='transform-3d'>
          <div className='rotate-x-[30deg] rotate-y-[24deg] rotate-[344deg]'>
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
