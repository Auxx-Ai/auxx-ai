// apps/homepage/src/app/blog/_components/mdx-components.tsx

import type { MDXComponents } from 'mdx/types'

export const mdxComponents: MDXComponents = {
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
  code: (props) => (
    <code className='bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-sm' {...props} />
  ),
  a: (props) => (
    <a
      className='text-primary hover:underline'
      target='_blank'
      rel='noopener noreferrer'
      {...props}
    />
  ),
  hr: () => <hr className='border-muted my-12' />,
}
