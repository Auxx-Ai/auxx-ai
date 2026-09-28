// apps/web/src/components/data-connectors/lib/connect-source-href.ts

/** Link to the connectors page with the "Connect a source" picker open on this app's connector. */
export function connectSourceHref(appSlug: string): string {
  return `/app/connectors?connect=app:${appSlug}`
}
