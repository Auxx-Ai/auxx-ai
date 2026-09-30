// apps/web/src/server/api/build-legs.ts

/** A build's stock movement as `builds.get` returns it, reduced to what orders it. */
interface BuildLeg {
  id: string
  type: string
  partName: string | null
}

/**
 * Produce leg first, then the consumed components by part name, then id. Keyed on the movement
 * type rather than the quantity sign, which a reversing build flips.
 */
export function compareBuildLegs(a: BuildLeg, b: BuildLeg): number {
  return (
    Number(b.type === 'build_produce') - Number(a.type === 'build_produce') ||
    (a.partName ?? '').localeCompare(b.partName ?? '') ||
    a.id.localeCompare(b.id)
  )
}
