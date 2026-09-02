// packages/sdk/__fixtures__/fields-app/src/fields.ts
//
// Fields fixture for the Layer 2 typed-values test. Declares a TEXT field and a
// SINGLE_SELECT with a literal option union so the generated augmentation can
// narrow `setFieldValues` / `getFieldValue` per field.

import { defineFields } from '@auxx/sdk/fields'

export const fields = defineFields([
  {
    key: 'customerId',
    type: 'TEXT',
    targetEntity: 'contact',
    scope: 'connection',
    name: 'Shopify customer ID',
    capabilities: { hidden: true, updatable: false },
  },
  {
    key: 'tier',
    type: 'SINGLE_SELECT',
    targetEntity: 'contact',
    scope: 'installation',
    name: 'Tier',
    options: [
      { value: 'gold', label: 'Gold' },
      { value: 'silver', label: 'Silver' },
    ],
  },
])
