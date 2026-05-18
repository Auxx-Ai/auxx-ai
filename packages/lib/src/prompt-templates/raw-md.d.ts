// packages/lib/src/prompt-templates/raw-md.d.ts
//
// Lets us `import x from './templates/x.md'` and get the file body
// as a string. Tsdown handles this via `loader: { '.md': 'text' }`;
// Vitest needs the matching plugin in `vitest.config.ts`. This
// declaration only quiets the TS compiler.

declare module '*.md' {
  const content: string
  export default content
}
