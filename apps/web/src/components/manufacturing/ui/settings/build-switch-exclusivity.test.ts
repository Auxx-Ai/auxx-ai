// apps/web/src/components/manufacturing/ui/settings/build-switch-exclusivity.test.ts

import { describe, expect, it } from 'vitest'
import { applyBuildSwitchExclusivity } from './build-switch-exclusivity'

describe('applyBuildSwitchExclusivity (111 Q14)', () => {
  it('turning backflush on turns order-raised builds off in the same patch', () => {
    expect(applyBuildSwitchExclusivity('inventory.backflush', true)).toEqual({
      'inventory.backflush': true,
      'inventory.autoBuildFromOrders': false,
    })
  })

  it('and the reverse', () => {
    expect(applyBuildSwitchExclusivity('inventory.autoBuildFromOrders', true)).toEqual({
      'inventory.autoBuildFromOrders': true,
      'inventory.backflush': false,
    })
  })

  it('turning one off touches nothing else', () => {
    expect(applyBuildSwitchExclusivity('inventory.backflush', false)).toEqual({
      'inventory.backflush': false,
    })
  })

  it('leaves an unrelated key alone', () => {
    expect(applyBuildSwitchExclusivity('inventory.autoBuildStockRule', 'always')).toEqual({
      'inventory.autoBuildStockRule': 'always',
    })
  })
})
