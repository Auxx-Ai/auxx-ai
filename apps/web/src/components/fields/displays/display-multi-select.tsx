// apps/web/src/components/fields/displays/display-multi-select.tsx

import { resolveTagLabels, TagsView } from '~/components/ui/tags-view'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'

/**
 * DisplayMultiSelect component
 * Renders selected options as badges for multi select using TagsView
 */
export function DisplayMultiSelect() {
  const { value, field } = useFieldContext()
  const options = field?.options?.options || []
  const tags = resolveTagLabels(value, options)
  const copyText = tags.join(', ')

  return (
    <DisplayWrapper copyValue={copyText || null}>
      <TagsView value={value} options={options} variant='pill' />
    </DisplayWrapper>
  )
}
