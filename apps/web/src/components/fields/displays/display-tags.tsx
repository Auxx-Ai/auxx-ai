// apps/web/src/components/fields/displays/display-tags.tsx
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'
import { TagsView, resolveTagLabels } from '~/components/ui/tags-view'

/**
 * DisplayTags component
 * Renders tags as small badges, looking up labels from field options
 */
export function DisplayTags() {
  const { value, field } = useFieldContext()
  const options = field?.options?.options || []
  const tags = resolveTagLabels(value, options)
  const copyText = tags.join(', ')

  return (
    <DisplayWrapper copyValue={copyText || null}>
      <TagsView value={value} options={options} variant="pill" />
    </DisplayWrapper>
  )
}
