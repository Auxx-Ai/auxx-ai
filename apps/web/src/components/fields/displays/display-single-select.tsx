// apps/web/src/components/fields/displays/display-single-select.tsx

import { resolveTagLabels, TagsView } from '~/components/ui/tags-view'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'

/**
 * DisplaySingleSelect component
 * Renders a single select value using TagsView
 */
export function DisplaySingleSelect() {
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

/**
 * DisplayMultiSelect component
 * Renders a multi select value
 */
// export function DisplayMultiSelect() {
//   const { value, field } = usePropertyContext()
//   const options = field.options || []
//   let labels = []
//   if (Array.isArray(value)) {
//     labels = value.map((v: any) => options.find((opt: any) => opt.value === v)?.label || v)
//   } else if (typeof value === 'string') {
//     labels = value
//       .split(',')
//       .map((v: any) => options.find((opt: any) => opt.value === v)?.label || v)
//   }
//   return <DisplayWrapper>{labels.join(', ')}</DisplayWrapper>
// }
