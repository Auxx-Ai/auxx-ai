// packages/sdk/__fixtures__/connector-app/src/list-options.tool.server.ts
//
// Stub resolver tool backing the connector's `configOptions.collection` dynamic
// select. Server code is stubbed by the catalog extractor — this just satisfies
// the `execute` import.

export default async function listOptions(): Promise<{ collections: { handle: string }[] }> {
  return { collections: [{ handle: 'summer' }, { handle: 'winter' }] }
}
