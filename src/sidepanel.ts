import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
  schemaCtx,
  serializerCtx,
} from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { getMarkdown, replaceAll } from '@milkdown/kit/utils'
import { nord } from '@milkdown/theme-nord'
import { inlineCodeCleanupPlugin } from './inline-code-cleanup'
import {
  compactMarkdownBlocksForCopy,
  normalizeMarkdownForCopy,
} from './markdown-copy'
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/theme-nord/style.css'
import './styles.css'

const initialMarkdown = ''
const sessionDraftKey = 'miniMdSessionDraft'

const editorRoot = document.querySelector<HTMLElement>('#editor')
const copyButton = document.querySelector<HTMLButtonElement>('#copy')
const compactCopyButton =
  document.querySelector<HTMLButtonElement>('#copy-compact')
const clearButton = document.querySelector<HTMLButtonElement>('#clear')
const status = document.querySelector<HTMLElement>('#status')

if (
  !editorRoot ||
  !copyButton ||
  !compactCopyButton ||
  !clearButton ||
  !status
) {
  throw new Error('SideMarkDown side panel markup is incomplete.')
}

let editor: Editor | undefined
let currentMarkdown = initialMarkdown
let statusTimer: number | undefined
let pendingSessionDraft: string | undefined
let sessionDraftWriteInFlight = false

copyButton.disabled = true
compactCopyButton.disabled = true
clearButton.disabled = true

const setStatus = (message: string) => {
  status.textContent = message
  if (statusTimer) window.clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => {
    status.textContent = ''
  }, 1400)
}

const logStorageWarning = (message: string, error: unknown) => {
  if (error instanceof Error) {
    console.warn(message, error)
    return
  }

  console.warn(message, String(error))
}

const loadSessionDraft = async (): Promise<string> => {
  try {
    const result = await chrome.storage.session.get(sessionDraftKey)
    const markdown = result[sessionDraftKey]

    return typeof markdown === 'string' ? markdown : initialMarkdown
  } catch (error) {
    logStorageWarning('Failed to load session draft.', error)
    return initialMarkdown
  }
}

const flushSessionDraft = async () => {
  if (sessionDraftWriteInFlight) return

  sessionDraftWriteInFlight = true

  try {
    while (pendingSessionDraft !== undefined) {
      const markdown = pendingSessionDraft
      pendingSessionDraft = undefined

      try {
        await chrome.storage.session.set({ [sessionDraftKey]: markdown })
      } catch (error) {
        logStorageWarning('Failed to persist session draft.', error)
      }
    }
  } finally {
    sessionDraftWriteInFlight = false
    if (pendingSessionDraft !== undefined) void flushSessionDraft()
  }
}

const persistSessionDraft = (markdown: string) => {
  pendingSessionDraft = markdown
  void flushSessionDraft()
}

const writeClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      console.warn('navigator.clipboard.writeText failed, falling back to execCommand.', error)
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

const createEditor = async () => {
  const sessionMarkdown = await loadSessionDraft()
  currentMarkdown = sessionMarkdown

  editor = await Editor.make()
    .config(nord)
    .config((ctx) => {
      ctx.set(rootCtx, editorRoot)
      ctx.set(defaultValueCtx, sessionMarkdown)
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        clipboardTextSerializer: (slice) => {
          const doc = ctx
            .get(schemaCtx)
            .topNodeType.createAndFill(undefined, slice.content)
          const markdown = doc
            ? ctx.get(serializerCtx)(doc)
            : slice.content.textBetween(0, slice.content.size, '\n\n')

          return normalizeMarkdownForCopy(markdown)
        },
      }))
      ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
        currentMarkdown = markdown
        persistSessionDraft(markdown)
      })
    })
    .use(commonmark)
    .use(inlineCodeCleanupPlugin)
    .use(history)
    .use(clipboard)
    .use(listener)
    .create()

  copyButton.disabled = false
  compactCopyButton.disabled = false
  clearButton.disabled = false
}

copyButton.addEventListener('click', async () => {
  if (!editor) return

  try {
    const markdown = normalizeMarkdownForCopy(
      editor.action(getMarkdown()) ?? currentMarkdown
    )
    await writeClipboard(markdown)
    setStatus('Copied')
  } catch (error) {
    console.error(error)
    setStatus('Copy failed')
  }
})

compactCopyButton.addEventListener('click', async () => {
  if (!editor) return

  try {
    const view = editor.ctx.get(editorViewCtx)
    const schema = editor.ctx.get(schemaCtx)
    const serialize = editor.ctx.get(serializerCtx)
    const serializedBlocks: string[] = []

    view.state.doc.forEach((node) => {
      if (node.type.name === 'paragraph' && node.content.size === 0) return

      const blockDocument = schema.topNodeType.createAndFill(undefined, node)
      if (blockDocument) serializedBlocks.push(serialize(blockDocument))
    })

    await writeClipboard(compactMarkdownBlocksForCopy(serializedBlocks))
    setStatus('Copied')
  } catch (error) {
    console.error(error)
    setStatus('Copy failed')
  }
})

clearButton.addEventListener('click', () => {
  if (!editor) return

  editor.action(replaceAll(''))
  currentMarkdown = ''
  persistSessionDraft('')
  setStatus('Cleared')
})

createEditor().catch((error) => {
  console.error(error)
  setStatus('Editor failed to load')
})
