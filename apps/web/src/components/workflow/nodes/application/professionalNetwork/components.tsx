// 🤖 AUTO-GENERATED from professionalNetwork.config.json - DO NOT EDIT

'use client'

import { useCallback } from 'react'
import { produce } from 'immer'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import Field from '~/components/workflow/ui/field'
import Section from '~/components/workflow/ui/section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@auxx/ui/components/select'
import { Textarea } from '@auxx/ui/components/textarea'
import { Input } from '@auxx/ui/components/input'
import type { ProfessionalNetworkNodeData, ProfessionalNetworkPanelProps } from './types'

export const ProfessionalNetworkPanel = ({ nodeId, data }: ProfessionalNetworkPanelProps) => {
  const { isReadOnly } = useReadOnly()
  const { inputs, setInputs } = useNodeCrud<ProfessionalNetworkNodeData>(nodeId, data)

  const updateField = useCallback(
    (field: keyof ProfessionalNetworkNodeData, value: any) => {
      const newInputs = produce(inputs, (draft) => {
        ;(draft as any)[field] = value
      })
      setInputs(newInputs)
    },
    [inputs, setInputs]
  )

  return (
    <BasePanel nodeId={nodeId} data={data}>
      {/* Action Section */}
      <Section title="Action">
        <Field title="What would you like to do?" required>
          <Select
            value={inputs?.action || 'publishContent'}
            onValueChange={(value) => updateField('action', value)}
            disabled={isReadOnly}>
            <SelectTrigger>
              <SelectValue placeholder="Select option" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem key="publishContent" value="publishContent">
                  <div>
                    <div className="font-medium">Publish Now</div>
                    <div className="text-sm text-gray-500">Publish content immediately</div>
                  </div>
                </SelectItem>
              <SelectItem key="scheduleContent" value="scheduleContent">
                  <div>
                    <div className="font-medium">Schedule</div>
                    <div className="text-sm text-gray-500">Schedule content for later</div>
                  </div>
                </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </Section>

      {/* Content Section */}
      <Section title="Content">
        <Field title="Content Type" required>
          <Select
            value={inputs?.contentType || 'textPost'}
            onValueChange={(value) => updateField('contentType', value)}
            disabled={isReadOnly}>
            <SelectTrigger>
              <SelectValue placeholder="Select option" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem key="textPost" value="textPost">
                  <div>
                    <div className="font-medium">Text Post</div>
                    <div className="text-sm text-gray-500">Simple text-based post</div>
                  </div>
                </SelectItem>
              <SelectItem key="imagePost" value="imagePost">
                  <div>
                    <div className="font-medium">Image Post</div>
                    <div className="text-sm text-gray-500">Post with image attachment</div>
                  </div>
                </SelectItem>
              <SelectItem key="articlePost" value="articlePost">
                  <div>
                    <div className="font-medium">Article Post</div>
                    <div className="text-sm text-gray-500">Post with article/link preview</div>
                  </div>
                </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field title="Text Content" required>
          <Textarea
            value={inputs?.textContent || ''}
            onChange={(e) => updateField('textContent', e.target.value)}
            placeholder="Enter your post content here..."
            rows={4}
            disabled={isReadOnly}
          />
        </Field>
      </Section>

      {/* Publishing Section */}
      <Section title="Publishing">
        <Field title="Post As" required>
          <Select
            value={inputs?.authorType || 'person'}
            onValueChange={(value) => updateField('authorType', value)}
            disabled={isReadOnly}>
            <SelectTrigger>
              <SelectValue placeholder="Select option" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem key="person" value="person">
                  <div>
                    <div className="font-medium">Personal Profile</div>
                    <div className="text-sm text-gray-500">Post from your personal LinkedIn profile</div>
                  </div>
                </SelectItem>
              <SelectItem key="organization" value="organization">
                  <div>
                    <div className="font-medium">Organization Page</div>
                    <div className="text-sm text-gray-500">Post from a company/organization page</div>
                  </div>
                </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {/* TODO: Implement conditional logic for postVisibility */}
        <Field title="Post Visibility">
          <Select
            value={inputs?.postVisibility || 'PUBLIC'}
            onValueChange={(value) => updateField('postVisibility', value)}
            disabled={isReadOnly}>
            <SelectTrigger>
              <SelectValue placeholder="Select option" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem key="PUBLIC" value="PUBLIC">
                  <div>
                    <div className="font-medium">Public</div>
                    <div className="text-sm text-gray-500">Visible to everyone on LinkedIn</div>
                  </div>
                </SelectItem>
              <SelectItem key="CONNECTIONS" value="CONNECTIONS">
                  <div>
                    <div className="font-medium">Connections Only</div>
                    <div className="text-sm text-gray-500">Visible only to your connections</div>
                  </div>
                </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </Section>

      {/* Image Settings Section */}
      <Section title="Image Settings" showWhen={[{"field":"contentType","operator":"equals","value":"imagePost"}]}>
        <Field title="Image Data Property" required>
          <Input
            value={inputs?.imageData || 'data'}
            onChange={(e) => updateField('imageData', e.target.value)}
            placeholder="Binary property name (e.g., 'data')"
            type="text"
            disabled={isReadOnly}
          />
        </Field>

        <Field title="Image Title">
          <Input
            value={inputs?.imageTitle || ''}
            onChange={(e) => updateField('imageTitle', e.target.value)}
            placeholder="Optional image title..."
            type="text"
            disabled={isReadOnly}
          />
        </Field>
      </Section>

      {/* Article Settings Section */}
      <Section title="Article Settings" showWhen={[{"field":"contentType","operator":"equals","value":"articlePost"}]}>
        <Field title="Article URL" required>
          <Input
            value={inputs?.articleUrl || ''}
            onChange={(e) => updateField('articleUrl', e.target.value)}
            placeholder="https://example.com/article"
            type="url"
            disabled={isReadOnly}
          />
        </Field>

        <Field title="Article Title" required>
          <Input
            value={inputs?.articleTitle || ''}
            onChange={(e) => updateField('articleTitle', e.target.value)}
            placeholder="Enter article title..."
            type="text"
            disabled={isReadOnly}
          />
        </Field>

        <Field title="Article Description">
          <Textarea
            value={inputs?.articleDescription || ''}
            onChange={(e) => updateField('articleDescription', e.target.value)}
            placeholder="Optional article description..."
            rows={3}
            disabled={isReadOnly}
          />
        </Field>
      </Section>

      {/* Scheduling Section */}
      <Section title="Scheduling" showWhen={[{"field":"action","operator":"equals","value":"scheduleContent"}]}>
        <Field title="Schedule Date" required>
          <Input
            type="datetime-local"
            value={inputs?.scheduleDate || ''}
            onChange={(e) => updateField('scheduleDate', e.target.value)}
            disabled={isReadOnly}
          />
        </Field>
      </Section>
    </BasePanel>
  )
}
