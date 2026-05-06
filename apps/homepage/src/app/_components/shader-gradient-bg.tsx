// apps/homepage/src/app/_components/shader-gradient-bg.tsx
'use client'

import type { ShaderGradientProps } from '@auxx/ui/components/shader-gradient'
import dynamic from 'next/dynamic'

/**
 * Client-only wrapper for `<ShaderGradient />`. Lets server components mount
 * the WebGL gradient without pulling `ogl` into the RSC graph or the main
 * route bundle. The CSS `linear-gradient` placeholder shows during SSR + the
 * mount window.
 */
const ShaderGradientLazy = dynamic(
  () => import('@auxx/ui/components/shader-gradient').then((m) => m.ShaderGradient),
  { ssr: false }
)

export function ShaderGradientBg(props: ShaderGradientProps) {
  return <ShaderGradientLazy {...props} />
}
