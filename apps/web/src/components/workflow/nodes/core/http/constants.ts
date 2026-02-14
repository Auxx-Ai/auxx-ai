import { BodyType, Method } from './types'

export const MethodOptions = [
  { label: 'GET', value: Method.get },
  { label: 'POST', value: Method.post },
  { label: 'HEAD', value: Method.head },
  { label: 'PATCH', value: Method.patch },
  { label: 'PUT', value: Method.put },
  { label: 'DELETE', value: Method.delete },
]

export const BodyTypeOptions = [
  { label: 'None', value: BodyType.none },
  { label: 'Form Data', value: BodyType.formData },
  { label: 'URL Encoded', value: BodyType.xWwwFormUrlencoded },
  { label: 'JSON', value: BodyType.json },
  { label: 'Raw Text', value: BodyType.rawText },
  { label: 'Binary', value: BodyType.binary },
]
