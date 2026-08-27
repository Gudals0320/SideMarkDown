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
import { inlineCodeCleanupPlugin } from './inline-code-cleanup'
import {
  createLibraryDocument,
  deleteLibraryDocument,
  formatLibraryUpdatedAt,
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
const libraryEmptyGoToEditor = requireElement<HTMLButtonElement>(
  '#library-empty-go-to-editor',
)
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
type StatusKind = 'success' | 'error'
type LibraryMutation = (
  documents: readonly LibraryDocument[],
) => readonly LibraryDocument[]

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
let libraryMutationQueue: Promise<void> = Promise.resolve()

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

const setStatus = (message: string, kind: StatusKind = 'success') => {
  status.textContent = message
  if (statusTimer) window.clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => {
    status.textContent = ''
  }, kind === 'success' ? 2_500 : 5_000)
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

const mutateLibraryDocuments = (
  mutation: LibraryMutation,
): Promise<void> => {
  const operation = libraryMutationQueue.then(async () => {
    const documents = mutation(libraryDocuments)
    await chrome.storage.local.set({ [libraryKey]: documents })
    libraryDocuments = documents
  })
  libraryMutationQueue = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
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
  editorTab.tabIndex = editorIsActive ? 0 : -1
  libraryTab.tabIndex = editorIsActive ? -1 : 0
  if (!editorIsActive) renderLibrary()
}

const setDocumentActionVisibility = (editingSavedDocument: boolean) => {
  for (const element of document.querySelectorAll<HTMLElement>('.draft-action')) {
    element.hidden = editingSavedDocument
  }
  for (const element of document.querySelectorAll<HTMLElement>('.document-action')) {
    element.hidden = !editingSavedDocument
  }
  editorActions.dataset.mode = editingSavedDocument ? 'saved-document' : 'draft'
  editorModeIndicator.hidden = !editingSavedDocument
}

const renderSavedDocumentContext = () => {
  if (editorMode.kind !== 'saved-document') {
    editorModeIndicator.hidden = true
    return
  }

  editorModeIndicator.hidden = false
  editorModeIndicator.textContent = `Editing saved document — ${editorMode.isDirty ? 'Unsaved changes' : 'Saved'}`
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
  renderSavedDocumentContext()
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
  renderSavedDocumentContext()
  editorRoot.querySelector<HTMLElement>('.ProseMirror')?.focus()
}

const createEditIcon = (): SVGSVGElement => {
  const namespace = 'http://www.w3.org/2000/svg'
  const icon = document.createElementNS(namespace, 'svg')
  icon.setAttribute('width', '16')
  icon.setAttribute('height', '16')
  icon.setAttribute('viewBox', '0 0 16 16')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-width', '1.75')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  icon.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(namespace, 'path')
  path.setAttribute(
    'd',
    'M8.5 13.5H14 M10.8 2.8a1.5 1.5 0 0 1 2.1 2.1L5.6 12.2 3 13l.8-2.6Z',
  )
  icon.appendChild(path)
  return icon
}

const createCopyIcon = (): SVGSVGElement => {
  const namespace = 'http://www.w3.org/2000/svg'
  const icon = document.createElementNS(namespace, 'svg')
  icon.setAttribute('width', '16')
  icon.setAttribute('height', '16')
  icon.setAttribute('viewBox', '0 0 16 16')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-width', '1.75')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  icon.setAttribute('aria-hidden', 'true')
  const front = document.createElementNS(namespace, 'rect')
  front.setAttribute('x', '5.25')
  front.setAttribute('y', '2.25')
  front.setAttribute('width', '7')
  front.setAttribute('height', '8')
  front.setAttribute('rx', '1')
  const back = document.createElementNS(namespace, 'path')
  back.setAttribute('d', 'M3.75 5.75h-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1')
  icon.append(front, back)
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

    const metadata = document.createElement('time')
    const formattedUpdatedAt = formatLibraryUpdatedAt(libraryDocument.updatedAt)
    metadata.className = 'library-card-metadata'
    metadata.dateTime = new Date(libraryDocument.updatedAt).toISOString()
    metadata.setAttribute('aria-label', `Updated ${formattedUpdatedAt}`)
    metadata.textContent = `Updated ${formattedUpdatedAt}`
    copy.appendChild(metadata)

    const preview = document.createElement('p')
    preview.className = 'library-card-preview'
    preview.textContent = content.preview
    copy.appendChild(preview)

    const copyAction = document.createElement('span')
    copyAction.className = 'library-card-copy-action'
    copyAction.append(createCopyIcon(), document.createTextNode('Copy'))
    copy.appendChild(copyAction)
    copy.addEventListener('click', () => {
      void writeClipboard(libraryDocument.markdown)
        .then(() => setStatus('Copied'))
        .catch((error: unknown) => {
          // no-excuse-ok: catch -- click handler reports clipboard boundary failure.
          logWarning('Failed to copy saved document.', error)
          setStatus('Copy failed', 'error')
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
    .config((ctx) => {
      ctx.set(rootCtx, editorRoot)
      ctx.set(defaultValueCtx, loadedSessionDraft)
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        attributes: {
          ...options.attributes,
          'data-placeholder': 'Start writing…',
        },
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
            renderSavedDocumentContext()
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

const activateLibraryTab = () => {
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
        setPanelView('editor')
        editorTab.focus()
        return
      }
      finishSavedDocumentEditing()
      break
    default:
      assertNever(activeMode)
  }
}

const focusTab = (tab: HTMLButtonElement) => {
  tab.focus()
}

for (const tab of [editorTab, libraryTab]) {
  tab.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        event.preventDefault()
        focusTab(tab === editorTab ? libraryTab : editorTab)
        break
      case 'Home':
        event.preventDefault()
        focusTab(editorTab)
        break
      case 'End':
        event.preventDefault()
        focusTab(libraryTab)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (tab === editorTab) setPanelView('editor')
        else activateLibraryTab()
        break
    }
  })
}

editorTab.addEventListener('click', () => {
  setPanelView('editor')
})

libraryEmptyGoToEditor.addEventListener('click', () => {
  setPanelView('editor')
  editorRoot.querySelector<HTMLElement>('.ProseMirror')?.focus()
})

libraryTab.addEventListener('click', () => {
  activateLibraryTab()
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
    setStatus('Copy failed', 'error')
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
    setStatus('Copy failed', 'error')
  }
})

clearButton.addEventListener('click', () => {
  if (!editor || editorMode.kind !== 'draft') return
  replaceEditorMarkdown('')
  sessionDraft = ''
  persistSessionDraft('')
  setStatus('Draft cleared')
})

saveDraftButton.addEventListener('click', async () => {
  if (!editor || editorMode.kind !== 'draft') return

  try {
    const id = libraryDocumentIdSchema.parse(crypto.randomUUID())
    const markdown = currentMarkdown
    await mutateLibraryDocuments((documents) =>
      createLibraryDocument({
        documents,
        id,
        markdown,
        timestamp: Math.max(
          Date.now(),
          (documents[0]?.updatedAt ?? -1) + 1,
        ),
      }),
    )
    setStatus('Saved to Library')
  } catch (error) {
    // no-excuse-ok: catch -- click handler reports local storage failure.
    logWarning('Failed to save a new Library document.', error)
    setStatus('Save failed', 'error')
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
        const markdown = editor.action(getMarkdown()) ?? currentMarkdown
        await mutateLibraryDocuments((documents) =>
          updateLibraryDocument({
            documents,
            id: activeMode.documentId,
            markdown,
            timestamp: Math.max(
              Date.now(),
              (documents[0]?.updatedAt ?? -1) + 1,
            ),
          }),
        )
        editorMode = {
          ...activeMode,
          baselineMarkdown: markdown,
          isDirty: false,
        }
        renderSavedDocumentContext()
        setStatus('Changes saved')
      } catch (error) {
        // no-excuse-ok: catch -- click handler reports local storage failure.
        logWarning('Failed to update the Library document.', error)
        setStatus('Save failed', 'error')
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
    const documentId = editorMode.documentId
    await mutateLibraryDocuments((documents) =>
      deleteLibraryDocument(documents, documentId),
    )
    finishSavedDocumentEditing()
    setStatus('Document deleted')
  } catch (error) {
    // no-excuse-ok: catch -- click handler reports local storage failure.
    logWarning('Failed to delete the Library document.', error)
    setStatus('Delete failed', 'error')
  }
})

createEditor().catch((error: unknown) => {
  // no-excuse-ok: catch -- application bootstrap is the top-level UI boundary.
  logWarning('Failed to create the editor.', error)
  setStatus('Editor failed to load', 'error')
})
