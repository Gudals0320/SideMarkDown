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
  createLibraryDocument,
  deleteLibraryDocument,
  getLibraryCardContent,
  libraryDocumentIdSchema,
  parseLibraryDocuments,
  updateLibraryDocument,
  type LibraryDocument,
  type LibraryDocumentId,
} from './library'
import type { SerializedMarkdownBlock } from './markdown-copy'
import {
  compactMarkdownBlocksForCopy,
  normalizeMarkdownForCopy,
} from './markdown-copy'
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/theme-nord/style.css'
import './styles.css'

const initialMarkdown = ''
const sessionDraftKey = 'miniMdSessionDraft'
const libraryKey = 'miniMdLibrary'

class MissingMarkupError extends Error {
  readonly name = 'MissingMarkupError'

  constructor(readonly selector: string) {
    super(`SideMarkDown side panel markup is missing ${selector}.`)
  }
}

class UnexpectedEditorModeError extends Error {
  readonly name = 'UnexpectedEditorModeError'

  constructor() {
    super('SideMarkDown reached an unexpected editor mode.')
  }
}

const assertNever = (_value: never): never => {
  throw new UnexpectedEditorModeError()
}

const requireElement = <ElementType extends Element>(
  selector: string,
): ElementType => {
  const element = document.querySelector<ElementType>(selector)
  if (!element) throw new MissingMarkupError(selector)
  return element
}

const editorRoot = requireElement<HTMLElement>('#editor')
const editorView = requireElement<HTMLElement>('#editor-view')
const libraryView = requireElement<HTMLElement>('#library-view')
const editorTab = requireElement<HTMLButtonElement>('#tab-editor')
const libraryTab = requireElement<HTMLButtonElement>('#tab-library')
const editorActions = requireElement<HTMLElement>('#editor-actions')
const copyButton = requireElement<HTMLButtonElement>('#copy')
const compactCopyButton = requireElement<HTMLButtonElement>('#copy-compact')
const clearButton = requireElement<HTMLButtonElement>('#clear')
const saveDraftButton = requireElement<HTMLButtonElement>('#save-draft')
const saveDocumentButton = requireElement<HTMLButtonElement>('#save-document')
const cancelDocumentButton =
  requireElement<HTMLButtonElement>('#cancel-document')
const deleteDocumentButton =
  requireElement<HTMLButtonElement>('#delete-document')
const editorModeIndicator = requireElement<HTMLElement>('#editor-mode')
const libraryList = requireElement<HTMLElement>('#library-list')
const libraryEmpty = requireElement<HTMLElement>('#library-empty')
const status = requireElement<HTMLElement>('#status')

type EditorMode =
  | { readonly kind: 'draft' }
  | {
      readonly kind: 'saved-document'
      readonly documentId: LibraryDocumentId
      readonly baselineMarkdown: string
      readonly isDirty: boolean
    }

type PanelView = 'editor' | 'library'

let editor: Editor | undefined
let currentMarkdown = initialMarkdown
let sessionDraft = initialMarkdown
let libraryDocuments: readonly LibraryDocument[] = []
let editorMode: EditorMode = { kind: 'draft' }
let currentView: PanelView = 'editor'
let statusTimer: number | undefined
let pendingSessionDraft: string | undefined
let sessionDraftWriteInFlight = false
let suppressEditorUpdate = false

for (const button of [
  copyButton,
  compactCopyButton,
  clearButton,
  saveDraftButton,
  saveDocumentButton,
  cancelDocumentButton,
  deleteDocumentButton,
]) {
  button.disabled = true
}
editorTab.disabled = true
libraryTab.disabled = true

const setStatus = (message: string) => {
  status.textContent = message
  if (statusTimer) window.clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => {
    status.textContent = ''
  }, 1_400)
}

const logWarning = (message: string, error: unknown) => {
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
    // no-excuse-ok: catch -- extension storage is a top-level UI boundary.
    logWarning('Failed to load session draft.', error)
    return initialMarkdown
  }
}

const loadLibraryDocuments = async (): Promise<readonly LibraryDocument[]> => {
  try {
    const result = await chrome.storage.local.get(libraryKey)
    return parseLibraryDocuments(result[libraryKey])
  } catch (error) {
    // no-excuse-ok: catch -- extension storage is a top-level UI boundary.
    logWarning('Failed to load prompt Library.', error)
    setStatus('Library failed to load')
    return []
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
        // no-excuse-ok: catch -- session persistence failure is non-fatal UI state.
        logWarning('Failed to persist session draft.', error)
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

const persistLibraryDocuments = async (
  documents: readonly LibraryDocument[],
) => {
  await chrome.storage.local.set({ [libraryKey]: documents })
  libraryDocuments = documents
}

const writeClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      // no-excuse-ok: catch -- the fallback is the expected boundary recovery.
      logWarning(
        'navigator.clipboard.writeText failed, falling back to execCommand.',
        error,
      )
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

const setPanelView = (view: PanelView) => {
  currentView = view
  const editorIsActive = view === 'editor'
  editorView.hidden = !editorIsActive
  libraryView.hidden = editorIsActive
  editorActions.hidden = !editorIsActive
  editorTab.setAttribute('aria-selected', String(editorIsActive))
  libraryTab.setAttribute('aria-selected', String(!editorIsActive))
  if (!editorIsActive) renderLibrary()
}

const setDocumentActionVisibility = (editingSavedDocument: boolean) => {
  for (const element of document.querySelectorAll<HTMLElement>('.draft-action')) {
    element.hidden = editingSavedDocument
  }
  for (const element of document.querySelectorAll<HTMLElement>('.document-action')) {
    element.hidden = !editingSavedDocument
  }
  editorModeIndicator.hidden = !editingSavedDocument
}

const replaceEditorMarkdown = (markdown: string) => {
  if (!editor) return

  suppressEditorUpdate = true
  currentMarkdown = markdown
  try {
    editor.action(replaceAll(markdown))
  } finally {
    suppressEditorUpdate = false
  }
}

const restoreDraftEditor = () => {
  editorMode = { kind: 'draft' }
  setDocumentActionVisibility(false)
  replaceEditorMarkdown(sessionDraft)
}

const finishSavedDocumentEditing = () => {
  restoreDraftEditor()
  setPanelView('library')
}

const editLibraryDocument = (documentId: LibraryDocumentId) => {
  const selectedDocument = libraryDocuments.find(
    (document) => document.id === documentId,
  )
  if (!selectedDocument) return

  editorMode = {
    kind: 'saved-document',
    documentId,
    baselineMarkdown: selectedDocument.markdown,
    isDirty: false,
  }
  setDocumentActionVisibility(true)
  replaceEditorMarkdown(selectedDocument.markdown)
  editorMode = {
    ...editorMode,
    baselineMarkdown: editor?.action(getMarkdown()) ?? selectedDocument.markdown,
  }
  setPanelView('editor')
  editorRoot.querySelector<HTMLElement>('.ProseMirror')?.focus()
}

const createEditIcon = (): SVGSVGElement => {
  const namespace = 'http://www.w3.org/2000/svg'
  const icon = document.createElementNS(namespace, 'svg')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-width', '2')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  icon.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(namespace, 'path')
  path.setAttribute(
    'd',
    'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  )
  icon.appendChild(path)
  return icon
}

function renderLibrary() {
  libraryList.replaceChildren()
  libraryEmpty.hidden = libraryDocuments.length > 0

  for (const libraryDocument of libraryDocuments) {
    const content = getLibraryCardContent(libraryDocument.markdown)
    const card = document.createElement('article')
    card.className = 'library-card'
    card.dataset.documentId = libraryDocument.id

    const copy = document.createElement('button')
    copy.className = 'library-card-copy'
    copy.type = 'button'
    copy.setAttribute(
      'aria-label',
      content.title ? `Copy ${content.title}` : 'Copy saved document',
    )

    if (content.title !== null) {
      const title = document.createElement('p')
      title.className = 'library-card-title'
      title.textContent = content.title
      copy.appendChild(title)
    }

    const preview = document.createElement('p')
    preview.className = 'library-card-preview'
    preview.textContent = content.preview
    copy.appendChild(preview)
    copy.addEventListener('click', () => {
      void writeClipboard(libraryDocument.markdown)
        .then(() => setStatus('Copied'))
        .catch((error: unknown) => {
          // no-excuse-ok: catch -- click handler reports clipboard boundary failure.
          logWarning('Failed to copy saved document.', error)
          setStatus('Copy failed')
        })
    })

    const edit = document.createElement('button')
    edit.className = 'library-card-edit'
    edit.type = 'button'
    edit.setAttribute('aria-label', 'Edit saved document')
    edit.title = 'Edit saved document'
    edit.appendChild(createEditIcon())
    edit.addEventListener('click', (event) => {
      event.stopPropagation()
      editLibraryDocument(libraryDocument.id)
    })

    card.append(copy, edit)
    libraryList.appendChild(card)
  }
}

const createEditor = async () => {
  const [loadedSessionDraft, loadedLibraryDocuments] = await Promise.all([
    loadSessionDraft(),
    loadLibraryDocuments(),
  ])
  sessionDraft = loadedSessionDraft
  currentMarkdown = loadedSessionDraft
  libraryDocuments = loadedLibraryDocuments

  editor = await Editor.make()
    .config(nord)
    .config((ctx) => {
      ctx.set(rootCtx, editorRoot)
      ctx.set(defaultValueCtx, loadedSessionDraft)
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
        if (suppressEditorUpdate) return
        currentMarkdown = markdown
        const activeMode = editorMode
        switch (activeMode.kind) {
          case 'draft':
            sessionDraft = markdown
            persistSessionDraft(markdown)
            break
          case 'saved-document':
            editorMode = {
              ...activeMode,
              isDirty: markdown !== activeMode.baselineMarkdown,
            }
            break
          default:
            assertNever(activeMode)
        }
      })
    })
    .use(commonmark)
    .use(inlineCodeCleanupPlugin)
    .use(history)
    .use(clipboard)
    .use(listener)
    .create()

  for (const button of [
    copyButton,
    compactCopyButton,
    clearButton,
    saveDraftButton,
    saveDocumentButton,
    cancelDocumentButton,
    deleteDocumentButton,
  ]) {
    button.disabled = false
  }
  editorTab.disabled = false
  libraryTab.disabled = false
  setDocumentActionVisibility(false)
  setPanelView(currentView)
}

editorTab.addEventListener('click', () => {
  setPanelView('editor')
})

libraryTab.addEventListener('click', () => {
  const activeMode = editorMode
  switch (activeMode.kind) {
    case 'draft':
      setPanelView('library')
      break
    case 'saved-document':
      const liveMarkdown = editor?.action(getMarkdown()) ?? currentMarkdown
      if (
        (activeMode.isDirty || liveMarkdown !== activeMode.baselineMarkdown) &&
        !window.confirm('Discard unsaved changes to this saved document?')
      ) {
        return
      }
      finishSavedDocumentEditing()
      break
    default:
      assertNever(activeMode)
  }
})

copyButton.addEventListener('click', async () => {
  if (!editor) return

  try {
    const markdown = normalizeMarkdownForCopy(
      editor.action(getMarkdown()) ?? currentMarkdown,
    )
    await writeClipboard(markdown)
    setStatus('Copied')
  } catch (error) {
    // no-excuse-ok: catch -- click handler reports clipboard boundary failure.
    logWarning('Failed to copy Markdown.', error)
    setStatus('Copy failed')
  }
})

compactCopyButton.addEventListener('click', async () => {
  if (!editor) return

  try {
    const view = editor.ctx.get(editorViewCtx)
    const schema = editor.ctx.get(schemaCtx)
    const serialize = editor.ctx.get(serializerCtx)
    const serializedBlocks: SerializedMarkdownBlock[] = []

    view.state.doc.forEach((node) => {
      if (node.type.name === 'paragraph' && node.content.size === 0) return
      const blockDocument = schema.topNodeType.createAndFill(undefined, node)
      if (!blockDocument) return
      serializedBlocks.push({
        type: node.type.name,
        markdown: serialize(blockDocument),
      })
    })

    await writeClipboard(compactMarkdownBlocksForCopy(serializedBlocks))
    setStatus('Copied')
  } catch (error) {
    // no-excuse-ok: catch -- click handler reports clipboard boundary failure.
    logWarning('Failed to copy compact Markdown.', error)
    setStatus('Copy failed')
  }
})

clearButton.addEventListener('click', () => {
  if (!editor || editorMode.kind !== 'draft') return
  replaceEditorMarkdown('')
  sessionDraft = ''
  persistSessionDraft('')
  setStatus('Cleared')
})

saveDraftButton.addEventListener('click', async () => {
  if (!editor || editorMode.kind !== 'draft') return

  try {
    const timestamp = Math.max(
      Date.now(),
      (libraryDocuments[0]?.updatedAt ?? -1) + 1,
    )
    const documents = createLibraryDocument({
      documents: libraryDocuments,
      id: libraryDocumentIdSchema.parse(crypto.randomUUID()),
      markdown: currentMarkdown,
      timestamp,
    })
    await persistLibraryDocuments(documents)
    setStatus('Saved')
  } catch (error) {
    // no-excuse-ok: catch -- click handler reports local storage failure.
    logWarning('Failed to save a new Library document.', error)
    setStatus('Save failed')
  }
})

saveDocumentButton.addEventListener('click', async () => {
  if (!editor) return

  const activeMode = editorMode
  switch (activeMode.kind) {
    case 'draft':
      return
    case 'saved-document':
      try {
        const timestamp = Math.max(
          Date.now(),
          (libraryDocuments[0]?.updatedAt ?? -1) + 1,
        )
        const documents = updateLibraryDocument({
          documents: libraryDocuments,
          id: activeMode.documentId,
          markdown: editor.action(getMarkdown()) ?? currentMarkdown,
          timestamp,
        })
        await persistLibraryDocuments(documents)
        finishSavedDocumentEditing()
        setStatus('Saved')
      } catch (error) {
        // no-excuse-ok: catch -- click handler reports local storage failure.
        logWarning('Failed to update the Library document.', error)
        setStatus('Save failed')
      }
      break
    default:
      assertNever(activeMode)
  }
})

cancelDocumentButton.addEventListener('click', () => {
  if (editorMode.kind !== 'saved-document') return
  finishSavedDocumentEditing()
})

deleteDocumentButton.addEventListener('click', async () => {
  if (editorMode.kind !== 'saved-document') return
  if (!window.confirm('Delete this saved document permanently?')) return

  try {
    const documents = deleteLibraryDocument(
      libraryDocuments,
      editorMode.documentId,
    )
    await persistLibraryDocuments(documents)
    finishSavedDocumentEditing()
    setStatus('Deleted')
  } catch (error) {
    // no-excuse-ok: catch -- click handler reports local storage failure.
    logWarning('Failed to delete the Library document.', error)
    setStatus('Delete failed')
  }
})

createEditor().catch((error: unknown) => {
  // no-excuse-ok: catch -- application bootstrap is the top-level UI boundary.
  logWarning('Failed to create the editor.', error)
  setStatus('Editor failed to load')
})
