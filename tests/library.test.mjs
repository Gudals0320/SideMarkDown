import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const libraryModulePath = path.join(root, 'src', 'library.ts')

const importLibraryModule = async () => {
  assert.equal(existsSync(libraryModulePath), true, 'src/library.ts must exist')

  const source = readFileSync(libraryModulePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const temporaryDirectory = mkdtempSync(
    path.join(root, `.library-test-${os.platform()}-`),
  )
  const modulePath = path.join(temporaryDirectory, 'library.mjs')
  writeFileSync(modulePath, output, 'utf8')

  try {
    return await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`)
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

test('parses only valid persisted library documents', async () => {
  // Given
  const { parseLibraryDocuments } = await importLibraryModule()
  const documents = [
    {
      id: '9bf6130b-065d-41fe-b4ee-c00a2d435620',
      markdown: '# Saved prompt',
      createdAt: 1_000,
      updatedAt: 2_000,
    },
  ]

  // When / Then
  assert.deepEqual(parseLibraryDocuments(documents), documents)
  assert.deepEqual(parseLibraryDocuments(undefined), [])
  assert.deepEqual(parseLibraryDocuments([{ ...documents[0], id: 'not-a-uuid' }]), [])
})

test('accepts the maximum JS Date timestamp and rejects the next millisecond', async () => {
  // Given
  const { parseLibraryDocuments } = await importLibraryModule()
  const maximumDateTimestamp = 8_640_000_000_000_000
  const document = {
    id: '9bf6130b-065d-41fe-b4ee-c00a2d435620',
    markdown: '# Date boundary',
    createdAt: maximumDateTimestamp,
    updatedAt: maximumDateTimestamp,
  }

  // When / Then
  assert.deepEqual(parseLibraryDocuments([document]), [document])
  assert.deepEqual(
    parseLibraryDocuments([{ ...document, createdAt: maximumDateTimestamp + 1 }]),
    [],
  )
  assert.deepEqual(
    parseLibraryDocuments([{ ...document, updatedAt: maximumDateTimestamp + 1 }]),
    [],
  )
})

test('derives card title and preview from the first Markdown line', async () => {
  // Given
  const { getLibraryCardContent } = await importLibraryModule()

  // When / Then
  assert.deepEqual(
    getLibraryCardContent('# Prompt title\nFirst body line\nSecond body line'),
    { title: 'Prompt title', preview: 'First body line\nSecond body line' },
  )
  assert.deepEqual(
    getLibraryCardContent('Intro line\nSecond line'),
    { title: null, preview: 'Intro line\nSecond line' },
  )
  assert.deepEqual(
    getLibraryCardContent('## Not an H1\nBody'),
    { title: null, preview: '## Not an H1\nBody' },
  )
  assert.deepEqual(getLibraryCardContent(''), { title: null, preview: '' })
})

test('formats Library metadata as a stable absolute English date', async () => {
  // Given
  const { formatLibraryUpdatedAt } = await importLibraryModule()
  const updatedAt = Date.UTC(2026, 7, 25, 12)

  // When / Then
  assert.equal(formatLibraryUpdatedAt(updatedAt), 'Aug 25, 2026')
  assert.equal(
    formatLibraryUpdatedAt(updatedAt),
    formatLibraryUpdatedAt(updatedAt + 60 * 60 * 1_000),
    'metadata must be a date, not a relative clock-derived phrase',
  )
})

test('creates a new document for every draft save, including duplicate Markdown', async () => {
  // Given
  const { createLibraryDocument } = await importLibraryModule()
  const first = createLibraryDocument({
    documents: [],
    id: '9bf6130b-065d-41fe-b4ee-c00a2d435620',
    markdown: '# Duplicate',
    timestamp: 1_000,
  })

  // When
  const second = createLibraryDocument({
    documents: first,
    id: '1b1b7555-1212-409c-9725-a65ab1e28ac3',
    markdown: '# Duplicate',
    timestamp: 2_000,
  })

  // Then
  assert.equal(second.length, 2)
  assert.deepEqual(second.map(({ id }) => id), [
    '1b1b7555-1212-409c-9725-a65ab1e28ac3',
    '9bf6130b-065d-41fe-b4ee-c00a2d435620',
  ])
  assert.deepEqual(second.map(({ markdown }) => markdown), [
    '# Duplicate',
    '# Duplicate',
  ])
})

test('updates one saved document and moves it to the top without duplication', async () => {
  // Given
  const { updateLibraryDocument } = await importLibraryModule()
  const documents = [
    {
      id: '9bf6130b-065d-41fe-b4ee-c00a2d435620',
      markdown: '# Older',
      createdAt: 1_000,
      updatedAt: 1_000,
    },
    {
      id: '1b1b7555-1212-409c-9725-a65ab1e28ac3',
      markdown: '# Target',
      createdAt: 2_000,
      updatedAt: 2_000,
    },
  ]

  // When
  const updated = updateLibraryDocument({
    documents,
    id: '9bf6130b-065d-41fe-b4ee-c00a2d435620',
    markdown: '# Updated',
    timestamp: 3_000,
  })

  // Then
  assert.equal(updated.length, 2)
  assert.equal(updated[0].id, '9bf6130b-065d-41fe-b4ee-c00a2d435620')
  assert.equal(updated[0].markdown, '# Updated')
  assert.equal(updated[0].createdAt, 1_000)
  assert.equal(updated[0].updatedAt, 3_000)
})

test('deletes only the selected saved document', async () => {
  // Given
  const { deleteLibraryDocument } = await importLibraryModule()
  const documents = [
    {
      id: '9bf6130b-065d-41fe-b4ee-c00a2d435620',
      markdown: '# Keep',
      createdAt: 1_000,
      updatedAt: 1_000,
    },
    {
      id: '1b1b7555-1212-409c-9725-a65ab1e28ac3',
      markdown: '# Delete',
      createdAt: 2_000,
      updatedAt: 2_000,
    },
  ]

  // When
  const remaining = deleteLibraryDocument(
    documents,
    '1b1b7555-1212-409c-9725-a65ab1e28ac3',
  )

  // Then
  assert.deepEqual(remaining.map(({ markdown }) => markdown), ['# Keep'])
})
