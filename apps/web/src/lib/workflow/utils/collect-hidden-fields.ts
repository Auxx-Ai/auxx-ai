// apps/web/src/lib/workflow/utils/collect-hidden-fields.ts

/**
 * A node in the serialized app-panel tree (see `reconstruct-react-tree.tsx`).
 * Only the fields relevant to visibility are typed here.
 */
interface PanelTreeNode {
  component?: string
  attributes?: Record<string, any>
  children?: PanelTreeNode[]
}

/**
 * Walk a serialized app workflow panel tree and return the names of input
 * fields that are currently hidden by a `ConditionalRender`.
 *
 * App blocks declare per-operation field visibility in their panel via
 * `<ConditionalRender when={(d) => d.operation === 'get'}>`. The reconciler
 * evaluates that predicate inside the iframe and serializes only the resulting
 * `shouldRender` boolean (`ConditionalRenderInternal`), with the input fields —
 * each carrying its `name` — nested beneath it. The host can't re-evaluate the
 * predicate, but it already receives this tree, so a field is hidden iff it sits
 * under a `ConditionalRender` whose `shouldRender` is `false`.
 *
 * Visibility composes: once an ancestor is hidden, everything beneath it is
 * hidden too, so nested `ConditionalRender`s are handled for free.
 *
 * @returns sorted, de-duplicated list of hidden field names
 */
export function collectHiddenFields(
  root: { children?: PanelTreeNode[] } | null | undefined
): string[] {
  const hidden = new Set<string>()

  const walk = (node: PanelTreeNode | null | undefined, inheritedHidden: boolean): void => {
    if (!node) return

    const isHidden =
      inheritedHidden ||
      (node.component === 'ConditionalRenderInternal' && node.attributes?.shouldRender === false)

    if (isHidden && typeof node.attributes?.name === 'string') {
      hidden.add(node.attributes.name)
    }

    node.children?.forEach((child) => walk(child, isHidden))
  }

  root?.children?.forEach((child) => walk(child, false))

  return Array.from(hidden).sort()
}
