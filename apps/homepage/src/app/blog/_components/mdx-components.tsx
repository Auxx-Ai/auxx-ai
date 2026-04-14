// apps/homepage/src/app/blog/_components/mdx-components.tsx

import type { MDXComponents } from 'mdx/types'
import type { ComponentPropsWithoutRef } from 'react'
import { ComparisonHero } from './comparison-hero'

export const mdxComponents: MDXComponents = {
  ComparisonHero,
  h1: (props) => <h1 className='text-foreground mb-4 mt-8 text-4xl font-bold' {...props} />,
  h2: (props) => (
    <h2 className='text-foreground mb-4 mt-16 scroll-mt-20 text-2xl font-semibold' {...props} />
  ),
  h3: (props) => (
    <h3 className='text-foreground mb-3 mt-6 scroll-mt-20 text-xl font-semibold' {...props} />
  ),
  h4: (props) => <h4 className='text-foreground mb-3 mt-6 text-lg font-semibold' {...props} />,
  p: (props) => <p className='text-muted-foreground mb-4 text-base leading-relaxed' {...props} />,
  blockquote: (props) => (
    <blockquote className='border-muted my-8 border-l-4 pl-4 text-xl italic' {...props} />
  ),
  ul: (props) => <ul className='text-muted-foreground mb-4 ml-6 list-disc space-y-2' {...props} />,
  ol: (props) => (
    <ol className='text-muted-foreground mb-4 ml-6 list-decimal space-y-2' {...props} />
  ),
  li: (props) => <li className='leading-relaxed' {...props} />,
  strong: (props) => <strong className='text-foreground font-semibold' {...props} />,
  em: (props) => <em className='italic' {...props} />,
  pre: (props: ComponentPropsWithoutRef<'pre'>) => (
    <pre
      className='mb-6 overflow-x-auto rounded-lg border p-4 text-[13px] leading-relaxed whitespace-pre-wrap break-words [&>code]:bg-transparent [&>code]:p-0'
      {...props}
    />
  ),
  code: (props: ComponentPropsWithoutRef<'code'>) => {
    // Shiki wraps fenced code in <pre><code> — those get className from shiki.
    // Inline code (no className) gets our styled treatment.
    if (props.className) {
      return <code {...props} />
    }
    return (
      <code
        className='bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-sm'
        {...props}
      />
    )
  },
  a: (props) => (
    <a
      className='text-primary hover:underline'
      target='_blank'
      rel='noopener noreferrer'
      {...props}
    />
  ),
  hr: () => <hr className='border-muted my-12' />,
  table: (props) => (
    <div className='mb-6 overflow-x-auto'>
      <table className='w-full border-collapse text-sm' {...props} />
    </div>
  ),
  thead: (props) => <thead className='border-b' {...props} />,
  th: (props) => <th className='text-foreground px-4 py-2 text-left font-semibold' {...props} />,
  td: (props) => <td className='text-muted-foreground border-b px-4 py-2' {...props} />,
}
