// apps/web/src/app/(protected)/app/rules/_components/testing/template-selector.tsx
'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Badge } from '@auxx/ui/components/badge'

interface Template {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
}

interface TemplateSelectorProps {
  onSelect: (template: Template) => void
}

export function TemplateSelector({ onSelect }: TemplateSelectorProps) {
  const templates: Template[] = [
    {
      id: 'order-confirmation',
      name: 'Order Confirmation',
      description: 'Test order confirmation emails with product details',
      category: 'E-commerce',
      tags: ['order', 'confirmation', 'receipt'],
    },
    {
      id: 'shipping-notification',
      name: 'Shipping Notification',
      description: 'Test shipping and tracking notification emails',
      category: 'E-commerce',
      tags: ['shipping', 'tracking', 'delivery'],
    },
    {
      id: 'support-request',
      name: 'Support Request',
      description: 'Test customer support inquiry emails',
      category: 'Support',
      tags: ['support', 'help', 'inquiry'],
    },
    {
      id: 'return-request',
      name: 'Return Request',
      description: 'Test product return and refund request emails',
      category: 'E-commerce',
      tags: ['return', 'refund', 'exchange'],
    },
  ]

  return (
    <div className="space-y-3">
      {templates.map((template) => (
        <Card
          key={template.id}
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => onSelect(template)}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">{template.name}</CardTitle>
                <CardDescription className="text-sm mt-1">{template.description}</CardDescription>
              </div>
              <Badge variant="secondary" className="text-xs">
                {template.category}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-1 flex-wrap">
              {template.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
