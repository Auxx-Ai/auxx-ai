// apps/homepage/src/app/free-tools/shader-gradient-preview/page.tsx
import type { Metadata } from 'next'
import { ShaderPreview } from './_components/shader-preview'

export const metadata: Metadata = {
  title: 'ShaderGradient Preview',
  robots: { index: false, follow: false },
}

export default function ShaderGradientPreviewPage() {
  return (
    <main className='min-h-screen bg-background p-6'>
      <div className='mx-auto max-w-6xl space-y-4'>
        <header>
          <h1 className='text-2xl font-semibold'>ShaderGradient — preset tuning</h1>
          <p className='text-sm text-muted-foreground'>
            Internal preview surface. Not indexed. Tweak preset, palette, and grain to dial in the
            preset defaults in <code>shader-gradient-presets.ts</code>.
          </p>
        </header>
        <ShaderPreview />
      </div>
    </main>
  )
}
