type Generic<T> = {
  [K in keyof T]: T[K] extends Array<infer U>
    ? Generic<U>[]
    : T[K] extends object
      ? Generic<T[K]>
      : T[K]
}

const shopifyTypes: Generic<{
  id: string
  title: string
}> = {
  id: '',
  title: '',
}
