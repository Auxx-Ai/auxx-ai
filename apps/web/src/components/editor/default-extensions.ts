import {
  AIHighlight,
  CharacterCount,
  Color,
  CustomKeymap,
  GlobalDragHandle,
  HighlightExtension,
  HorizontalRule,
  MarkdownExtension,
  Placeholder,
  StarterKit,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  TableView,
  TaskItem,
  TaskList,
  TextStyle,
  TiptapImage,
  TiptapLink,
  TiptapUnderline,
  UpdatedImage,
  FontSize,
} from './extensions'
import { UploadImagesPlugin } from './plugins'

import { cx } from 'class-variance-authority'
// import { common, createLowlight } from 'lowlight'

//TODO I am using cx here to get tailwind autocomplete working, idk if someone else can write a regex to just capture the class key in objects
const aiHighlight = AIHighlight
//You can overwrite the placeholder with your own configuration
const placeholder = Placeholder
const tiptapLink = TiptapLink.configure({
  HTMLAttributes: {
    class: cx(
      'text-muted-foreground underline underline-offset-[3px] hover:text-foreground transition-colors cursor-pointer'
    ),
  },
})

const tiptapImage = TiptapImage.extend({
  addProseMirrorPlugins() {
    return [UploadImagesPlugin({ imageClass: cx('opacity-40 rounded-lg border border-stone-200') })]
  },
}).configure({ allowBase64: true, HTMLAttributes: { class: cx('rounded-lg border border-muted') } })

const updatedImage = UpdatedImage.configure({
  HTMLAttributes: { class: cx('rounded-lg border border-muted') },
})

const taskList = TaskList.configure({ HTMLAttributes: { class: cx('not-prose !ml-0 !pl-0') } })
const taskItem = TaskItem.configure({
  HTMLAttributes: { class: cx('flex gap-2 items-start') },
  nested: true,
})

const horizontalRule = HorizontalRule.configure({
  HTMLAttributes: { class: cx('mt-4 mb-6 border-t border-background') },
})

const starterKit = StarterKit.configure({
  bulletList: { HTMLAttributes: { class: cx('list-disc list-outside leading-3 -mt-2') } },
  orderedList: { HTMLAttributes: { class: cx('list-decimal list-outside leading-3 -mt-2') } },
  listItem: { HTMLAttributes: { class: cx('leading-normal -mb-2') } },
  blockquote: { HTMLAttributes: { class: cx('border-l-4 border-primary') } },
  codeBlock: {
    HTMLAttributes: {
      class: cx('rounded-md bg-muted text-muted-foreground border p-5 font-mono font-medium'),
    },
  },
  code: {
    HTMLAttributes: {
      class: cx('rounded-md bg-muted  px-1.5 py-1 font-mono font-medium'),
      spellcheck: 'false',
    },
  },
  horizontalRule: false,
  dropcursor: { color: '#DBEAFE', width: 4 },
  gapcursor: false,
})

// const codeBlockLowlight = CodeBlockLowlight.configure({
//   // configure lowlight: common /  all / use highlightJS in case there is a need to specify certain language grammars only
//   // common: covers 37 language grammars which should be good enough in most cases
//   lowlight: createLowlight(common),
// })

// const youtube = Youtube.configure({
//   HTMLAttributes: { class: cx('rounded-lg border border-muted') },
//   inline: false,
// })

// const twitter = Twitter.configure({
//   HTMLAttributes: { class: cx('not-prose') },
//   inline: false,
// })

// const mathematics = Mathematics.configure({
//   HTMLAttributes: {
//     class: cx('text-foreground rounded p-1 hover:bg-accent cursor-pointer'),
//   },
//   katexOptions: { throwOnError: false },
// })

const characterCount = CharacterCount.configure()

const markdownExtension = MarkdownExtension.configure({
  html: true,
  tightLists: true,
  tightListClass: 'tight',
  bulletListMarker: '-',
  linkify: false,
  breaks: false,
  transformPastedText: false,
  transformCopiedText: false,
})

const table = Table.configure({ resizable: false })

const globalDragHandle = GlobalDragHandle.configure({
  excludedTags: ['table', 'table-header', 'table-row', 'table-cell'],
})

export const defaultExtensions = [
  starterKit,
  placeholder,
  tiptapLink,
  tiptapImage,
  updatedImage,
  taskList,
  taskItem,
  horizontalRule,
  aiHighlight,
  characterCount,
  TiptapUnderline,
  markdownExtension,
  HighlightExtension,
  TextStyle,
  Color,
  CustomKeymap,
  globalDragHandle,
  table,
  TableCell,
  TableHeader,
  TableRow,
  TableView,
  FontSize,
]
