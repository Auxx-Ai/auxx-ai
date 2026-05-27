// apps/web/src/components/chat-widget/ui/settings/sections/setup-snippets.ts
import { CodeLanguage } from '~/components/workflow/ui/code-editor/types'

export type SetupFramework = 'code' | 'react' | 'vue' | 'angular'
export type SetupCodeFlavor = 'basic-js' | 'npm' | 'spa'

export interface SetupSnippetBlock {
  language: CodeLanguage
  value: string
  title?: string
}

export interface SetupSnippet {
  label: string
  blocks: SetupSnippetBlock[]
  note: string
}

const installBlock: SetupSnippetBlock = {
  language: CodeLanguage.shell,
  value: 'npm install @auxx/chat',
  title: 'Install',
}

export function getSetupSnippets(channelId: string): {
  code: Record<SetupCodeFlavor, SetupSnippet>
  react: SetupSnippet
  vue: SetupSnippet
  angular: SetupSnippet
} {
  const id = channelId || '<channelId>'
  return {
    code: {
      'basic-js': {
        label: 'Basic JS',
        blocks: [
          {
            language: CodeLanguage.html,
            value: `<script
  src="https://app.auxx.ai/scripts/chat-widget.js"
  data-channel-id="${id}"
  async defer></script>`,
            title: 'Basic JS',
          },
        ],
        note: 'Paste just before </body> on every page that should show the widget. Zero build step — works on any HTML page.',
      },
      npm: {
        label: 'npm package',
        blocks: [
          installBlock,
          {
            language: CodeLanguage.typescript,
            value: `import Auxx from '@auxx/chat'

Auxx.boot({ channelId: '${id}' })`,
            title: 'Boot',
          },
        ],
        note: 'Call once after the page loads. Pass userJwt or attributes later by calling Auxx.boot again with the same channelId — same-channel re-boots are a soft refresh.',
      },
      spa: {
        label: 'Single page app',
        blocks: [
          installBlock,
          {
            language: CodeLanguage.typescript,
            value: `import Auxx from '@auxx/chat'

// On app start / login:
Auxx.boot({ channelId: '${id}', userJwt })

// On user data change (no reboot):
Auxx.update({ plan: 'pro' })

// On logout:
Auxx.shutdown()`,
            title: 'Lifecycle',
          },
        ],
        note: 'Same package as npm. Use shutdown so the next user starts cold, update for in-place attribute pushes, and boot again for full re-init.',
      },
    },
    react: {
      label: 'React',
      blocks: [
        installBlock,
        {
          language: CodeLanguage.typescript,
          value: `import { AuxxChat } from '@auxx/chat/react'

export function AppRoot() {
  return (
    <>
      {/* … your app … */}
      <AuxxChat channelId="${id}" userJwt={token} />
    </>
  )
}`,
          title: 'React',
        },
      ],
      note: 'Mount once at your app root. The component handles boot, update, and shutdown for you.',
    },
    vue: {
      label: 'Vue',
      blocks: [
        installBlock,
        {
          language: CodeLanguage.html,
          value: `<!-- components/AuxxChat.vue -->
<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import Auxx from '@auxx/chat'

const props = defineProps<{
  channelId: string
  userJwt?: string
  attributes?: Record<string, unknown>
}>()

onMounted(() => {
  Auxx.boot({
    channelId: props.channelId,
    userJwt: props.userJwt,
    attributes: props.attributes,
  })
})
onUnmounted(() => {
  Auxx.shutdown()
})
watch(
  () => props.attributes,
  (next) => next && Auxx.update(next),
  { deep: true }
)
</script>

<template></template>`,
          title: 'Vue SFC',
        },
        {
          language: CodeLanguage.html,
          value: `<!-- App.vue -->
<script setup lang="ts">
import AuxxChat from './components/AuxxChat.vue'
</script>

<template>
  <!-- … your app … -->
  <AuxxChat channel-id="${id}" :user-jwt="token" />
</template>`,
          title: 'Usage',
        },
      ],
      note: 'Drop the component into your app root once. It boots on mount, syncs attribute changes via watch, and shuts down on unmount.',
    },
    angular: {
      label: 'Angular',
      blocks: [
        installBlock,
        {
          language: CodeLanguage.typescript,
          value: `// auxx-chat.component.ts
import { Component, Input, OnDestroy, OnInit } from '@angular/core'
import Auxx from '@auxx/chat'

@Component({ selector: 'auxx-chat', template: '' })
export class AuxxChatComponent implements OnInit, OnDestroy {
  @Input() channelId!: string
  @Input() userJwt?: string

  ngOnInit() {
    Auxx.boot({ channelId: this.channelId, userJwt: this.userJwt })
  }
  ngOnDestroy() {
    Auxx.shutdown()
  }
}`,
          title: 'Angular component',
        },
        {
          language: CodeLanguage.html,
          value: `<!-- app.component.html -->
<!-- … your app … -->
<auxx-chat channelId="${id}" [userJwt]="token"></auxx-chat>`,
          title: 'Usage',
        },
      ],
      note: 'Declare the component in your app module and drop it in once at the root. It boots on init and shuts down on destroy.',
    },
  }
}
