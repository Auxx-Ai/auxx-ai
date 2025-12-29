// apps/web/src/components/contacts/displays/display-multi-select.tsx
import DisplayWrapper from './display-wrapper'
import { usePropertyContext } from '../drawer/property-provider'
import { TagsView, resolveTagLabels } from '~/components/ui/tags-view'

/**
 * DisplayMultiSelect component
 * Renders selected options as badges for multi select using TagsView
 */
export function DisplayMultiSelect() {
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
