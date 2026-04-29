// apps/web/src/components/kb/ui/preview/kb-preview.tsx
'use client'

import React from 'react'
import type { KnowledgeBase } from '../../store/knowledge-base-store'
import { KBPreviewTopBar } from './kb-preview-topbar'
import { PreviewProvider, usePreview } from './preview-context'

const BASE_CONTAINER_H = 1027
const BASE_FRAME_H = 995
const BASE_SVG_W = 516
const BASE_SVG_H = 995
const BASE_SCREEN_W = 451
const BASE_SCREEN_H = 802
const BASE_SCREEN_TOP = 155
const BASE_SCREEN_LEFT = 33

interface KBPreviewProps {
  knowledgeBase: KnowledgeBase
}

function KBPreviewInner() {
  const { isMobile, isDark, knowledgeBase } = usePreview()
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const [scale, setScale] = React.useState(1)

  React.useLayoutEffect(() => {
    if (!wrapperRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      const { height } = entry.contentRect
      setScale(height / BASE_CONTAINER_H)
    })
    observer.observe(wrapperRef.current)
    return () => observer.disconnect()
  }, [])

  const frameH = BASE_FRAME_H * scale
  const svgW = BASE_SVG_W * scale
  const svgH = BASE_SVG_H * scale
  const screenW = BASE_SCREEN_W * scale
  const screenH = BASE_SCREEN_H * scale
  const screenT = BASE_SCREEN_TOP * scale
  const screenL = BASE_SCREEN_LEFT * scale

  return (
    <div className='flex flex-1 flex-col'>
      <KBPreviewTopBar />

      <div
        ref={wrapperRef}
        className='flex flex-1 flex-col items-center justify-center bg-muted p-4'>
        {isMobile ? (
          <div className='flex items-end' style={{ height: frameH }}>
            <div className='relative'>
              <svg
                width={svgW}
                height={svgH}
                viewBox='0 0 332 640'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'>
                <title>Mobile Frame</title>
                <g filter='url(#filter0_d_378_3409)'>
                  <rect x='12' y='10' width='308' height='616' rx='32' fill='white' />
                  <rect x='12.5' y='10.5' width='307' height='615' rx='31.5' stroke='#D3DCE4' />
                </g>
                <rect
                  x='17'
                  y='15'
                  width='298'
                  height='606'
                  rx='27'
                  stroke='#F5F7F9'
                  strokeWidth='8'
                />
                <path
                  d='M95 11H241V25C241 36.0457 232.046 45 221 45H115C103.954 45 95 36.0457 95 25V11Z'
                  fill='#F5F7F9'
                />
                <rect x='144' y='26' width='33' height='8' rx='4' fill='white' />
                <circle cx='189' cy='30' r='4' fill='white' />
                <rect x='36' y='66' width='260' height='24' rx='12' fill='#F5F7F9' />
                <text id='textUrl' x='70' y='83' fontFamily='Arial' fontSize='12' fill='#333' />
                <path
                  d='M59 76.3333H58.5V75.381C58.5 74.7495 58.2366 74.1439 57.7678 73.6974C57.2989 73.2508 56.663 73 56 73C55.337 73 54.7011 73.2508 54.2322 73.6974C53.7634 74.1439 53.5 74.7495 53.5 75.381V76.3333H53C52.45 76.3333 52 76.7619 52 77.2857V82.0476C52 82.5714 52.45 83 53 83H59C59.55 83 60 82.5714 60 82.0476V77.2857C60 76.7619 59.55 76.3333 59 76.3333ZM56 80.619C55.45 80.619 55 80.1905 55 79.6667C55 79.1429 55.45 78.7143 56 78.7143C56.55 78.7143 57 79.1429 57 79.6667C57 80.1905 56.55 80.619 56 80.619ZM57.55 76.3333H54.45V75.381C54.45 74.5667 55.145 73.9048 56 73.9048C56.855 73.9048 57.55 74.5667 57.55 75.381V76.3333Z'
                  fill='#3B454E'
                />
                <defs>
                  <filter
                    id='filter0_d_378_3409'
                    x='0'
                    y='0'
                    width='332'
                    height='640'
                    filterUnits='userSpaceOnUse'
                    colorInterpolationFilters='sRGB'>
                    <feFlood floodOpacity='0' result='BackgroundImageFix' />
                    <feColorMatrix
                      in='SourceAlpha'
                      type='matrix'
                      values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
                      result='hardAlpha'
                    />
                    <feOffset dy='2' />
                    <feGaussianBlur stdDeviation='6' />
                    <feComposite in2='hardAlpha' operator='out' />
                    <feColorMatrix
                      type='matrix'
                      values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.06 0'
                    />
                    <feBlend
                      mode='normal'
                      in2='BackgroundImageFix'
                      result='effect1_dropShadow_378_3409'
                    />
                    <feBlend
                      mode='normal'
                      in='SourceGraphic'
                      in2='effect1_dropShadow_378_3409'
                      result='shape'
                    />
                  </filter>
                </defs>
              </svg>

              <div
                className='absolute overflow-hidden'
                style={{
                  top: screenT,
                  left: screenL,
                  width: screenW,
                  height: screenH,
                  borderBottomLeftRadius: screenL,
                  borderBottomRightRadius: screenL,
                }}>
                <div
                  className='relative h-full w-full overflow-hidden rounded border'
                  style={{ colorScheme: isDark ? 'dark' : 'light' }}>
                  {knowledgeBase && (
                    <iframe
                      src={`/kb/preview/${knowledgeBase.id}?theme=${isDark ? 'dark' : 'light'}&device=mobile`}
                      style={{ width: '100%', height: '100%', border: 'none', margin: 0 }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className='relative h-full w-full'
            style={{ colorScheme: isDark ? 'dark' : 'light' }}>
            <div className='relative h-full w-full overflow-hidden rounded border border-foreground/10 bg-background'>
              {knowledgeBase && (
                <iframe
                  src={`/kb/preview/${knowledgeBase.id}?theme=${isDark ? 'dark' : 'light'}&device=desktop`}
                  style={{ width: '100%', height: '100%', border: 'none', margin: 0 }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function KBPreview({ knowledgeBase }: KBPreviewProps) {
  return (
    <PreviewProvider knowledgeBase={knowledgeBase}>
      <KBPreviewInner />
    </PreviewProvider>
  )
}
