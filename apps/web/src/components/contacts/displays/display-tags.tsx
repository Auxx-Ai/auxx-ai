// apps/web/src/components/contacts/displays/display-tags.tsx
import { usePropertyContext } from '../drawer/property-provider'
import DisplayWrapper from './display-wrapper'
import { TagsView, resolveTagLabels } from '~/components/ui/tags-view'

/**
 * DisplayTags component
 * Renders tags as small badges, looking up labels from field options
 */
export function DisplayTags() {
  const { value, field } = usePropertyContext()
  const options = field?.options?.options || []
  const tags = resolveTagLabels(value, options)
  const copyText = tags.join(', ')

  return (
    <DisplayWrapper copyValue={copyText || null}>
      <TagsView value={value} options={options} variant="pill" />
    </DisplayWrapper>
  )
}
