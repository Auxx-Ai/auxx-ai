// packages/ui/src/css-modules.d.ts
//
// CSS Modules ambient declaration. Consuming apps get this from their bundler's
// generated types (e.g. Next's `next-env.d.ts`), but `@auxx/ui`'s own
// `tsc --noEmit` has no such file, so `import styles from './x.module.css'`
// would otherwise fail to resolve.

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
