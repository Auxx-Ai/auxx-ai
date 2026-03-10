import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'
import { Banner } from 'fumadocs-ui/components/banner'
import { type CardProps, Card as FumadocsCard } from 'fumadocs-ui/components/card'
import { File, Files, Folder } from 'fumadocs-ui/components/files'
import { ImageZoom } from 'fumadocs-ui/components/image-zoom'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import { TypeTable } from 'fumadocs-ui/components/type-table'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { icons } from 'lucide-react'
import type { MDXComponents } from 'mdx/types'
import { createElement } from 'react'
import { SearchHero } from './components/search-hero'

function Card({ icon, ...props }: CardProps & { icon?: string }) {
  const resolvedIcon =
    typeof icon === 'string' && icon in icons
      ? createElement(icons[icon as keyof typeof icons])
      : icon
  return <FumadocsCard icon={resolvedIcon} {...props} />
}

// use this function to get MDX components, you will need it for rendering MDX
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    img: (props) => (
      <ImageZoom
        {...(props as any)}
        className='w-full object-cover overflow-hidden rounded-lg border shadow-xl'
      />
    ),
    Accordion,
    Accordions,
    Banner,
    File,
    Files,
    Folder,
    Step,
    Steps,
    Tab,
    Tabs,
    TypeTable,
    Card,
    SearchHero,
    ...components,
  }
}
