import DOMPurify from 'dompurify'
import DisplayWrapper from './display-wrapper'
import { usePropertyContext } from '../drawer/property-provider'

/**
 * DisplayRichText component
 * Renders a rich text value
 */
export function DisplayRichText() {
  const { value } = usePropertyContext()
  const richText = typeof value === 'string' ? value : ''
  return (
    <DisplayWrapper copyValue={richText || null}>
      <div
        className="prose max-w-none prose-sm dark:prose-invert prose-p:text-sm prose-p:leading-6 prose-p:mb-2 prose-p:mt-0 prose-p:text-muted-foreground prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-img:rounded-lg prose-img:max-w-full"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(richText) }}
      />
    </DisplayWrapper>
  )
}
