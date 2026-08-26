import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const readText = (...segments) => readFileSync(path.join(root, ...segments), 'utf8')
const readJson = (...segments) => JSON.parse(readText(...segments))
const designContractPath = () => process.env.SIDEMARKDOWN_DESIGN_CONTRACT_PATH
  ?? path.join(root, 'DESIGN.md')
const requiredDesignSections = [
  '1. Atmosphere & Identity',
  '2. Color',
  '3. Typography',
  '4. Spacing & Layout',
  '5. Components',
  '6. Motion & Interaction',
  '7. Depth & Surface',
  '8. Accessibility Constraints & Accepted Debt',
]
const requiredPaletteRows = [
  ['Canvas', '#F2F0EB', '#1F211F'],
  ['Surface', '#F8F7F3', '#262925'],
  ['Editor surface', '#FFFDF8', '#232522'],
  ['Surface subtle', '#ECE9E2', '#2D312C'],
  ['Ink', '#2A2927', '#EAE7DF'],
  ['Ink strong', '#181715', '#FFFDF7'],
  ['Ink muted', '#67635D', '#B0ACA2'],
  ['Ink faint', '#8A857C', '#817D74'],
  ['Border', '#D9D4CA', '#41443E'],
  ['Border strong', '#B9B2A7', '#5D625A'],
  ['Accent', '#4C6FA3', '#9CB5D4'],
  ['Accent strong', '#355884', '#C2D2E7'],
  ['Accent soft', '#E5EBF3', '#313A46'],
  ['Danger', '#A84C47', '#E3A09A'],
  ['Danger soft', '#F5E7E4', '#4A302F'],
  ['Inline-code ink', '#5A4630', '#E6C79D'],
  ['Inline-code surface', '#F1EADF', '#3A332A'],
  ['Code surface', '#24282E', '#171A1F'],
  ['Code ink', '#F4EFE6', '#F2EFE8'],
  ['Quote rule', '#8DA1B9', '#71869F'],
  ['Quote surface', '#F1F3F6', '#292E34'],
  ['Selection', '#CBD8E8', '#465873'],
  ['Selection ink', '#1A2230', '#FFFDF7'],
  ['Caret', '#355884', '#C2D2E7'],
]
const requiredComponents = [
  'App shell',
  'Manual tablist',
  'Copy action group',
  'Document action group',
  'Transient status region',
  'Saved-document context strip',
  'ProseMirror paper surface',
  'Library card',
  'Library empty state',
]
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const countHeading = (source, heading) => (
  source.match(new RegExp(`^### ${escapeRegex(heading)}$`, 'gm')) ?? []
).length
const assertDesignContract = (design) => {
  const h2Sections = [...design.matchAll(/^## (?!#)(.+)$/gm)].map(([, heading]) => heading)

  assert.deepEqual(h2Sections.slice(0, requiredDesignSections.length), requiredDesignSections)
  assert.equal(design.includes('## 0. Research Log'), false, 'existing-project contract must not add a greenfield Research Log')
  for (const section of requiredDesignSections) {
    assert.equal((design.match(new RegExp(`^## ${escapeRegex(section)}$`, 'gm')) ?? []).length, 1, `section must appear once: ${section}`)
  }
  for (const [role, light, dark] of requiredPaletteRows) {
    assert.match(design, new RegExp('\\\\| ' + escapeRegex(role) + ' \\| `' + escapeRegex(light) + '` \\| `' + escapeRegex(dark) + '` \\|'), `palette row missing: ${role}`)
  }
  for (const component of requiredComponents) {
    assert.equal(countHeading(design, component), 1, `component primitive must appear once: ${component}`)
  }
  for (const mockup of [
    'editor-draft-light-v2.png',
    'library-draft-light.png',
    'editing-draft-light-v2.png',
  ]) assert.match(design, new RegExp(escapeRegex(mockup)))

  assert.match(design, /Quiet Paper Workbench/)
  assert.match(design, /15px\/1\.72/)
  assert.match(design, /H1-H6/)
  assert.match(design, /base of \*\*4px\*\*/)
  assert.match(design, /72ch/)
  assert.match(design, /ArrowLeft\/ArrowRight\/Home\/End/)
  assert.match(design, /Enter\/Space activates/)
  assert.match(design, /Start writing…/)
  assert.match(design, /120ms/)
  assert.match(design, /transform, opacity, and color/)
  assert.match(design, /prefers-reduced-motion/)
  assert.match(design, /tonal-shift plus whisper-border/)
  assert.match(design, /chrome-extension:\/\/.*Lighthouse/s)
  assert.match(design, /SEO is inapplicable/)
  assert.match(design, /sidepanel\.js <= 140000 bytes/)
  assert.match(design, /sidepanel\.css <= 8192 bytes/)
  assert.match(design, /sidepanel\.html <= 12288 bytes/)
  assert.match(design, /No debt accepted\./)
}
const importTypeScriptModule = async (...segments) => {
  const sourcePath = path.join(root, ...segments)
  const source = readFileSync(sourcePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const temporaryDirectory = mkdtempSync(
    path.join(root, `.mini-md-test-${os.platform()}-`),
  )
  const modulePath = path.join(
    temporaryDirectory,
    `${path.basename(sourcePath, '.ts')}.mjs`,
  )

  writeFileSync(modulePath, output, 'utf8')

  try {
    return await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`)
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

test('design contract fixes the Quiet Paper Workbench system before UI changes', () => {
  const contractPath = designContractPath()
  assert.equal(existsSync(contractPath), true, `DESIGN.md must exist at ${contractPath}`)
  assertDesignContract(readFileSync(contractPath, 'utf8'))
})

test('dependency sources and CI actions are immutable and public', () => {
  const lockfile = readText('package-lock.json')
  const workflow = readText('.github', 'workflows', 'ci.yml')

  assert.equal(
    lockfile.includes('packages.applied-caas-gateway1.internal.api.openai.org'),
    false,
    'package-lock.json must not pin dependencies to the internal OpenAI npm gateway',
  )
  const actionUses = [...workflow.matchAll(/^\s*- uses: ([^@\s]+)@([^\s]+) # (\S+)$/gm)]
    .map(([, action, revision, version]) => ({ action, revision, version }))

  assert.deepEqual(actionUses, [
    {
      action: 'actions/checkout',
      revision: 'fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09',
      version: 'v5',
    },
    {
      action: 'actions/setup-node',
      revision: 'a0853c24544627f65ddf259abe73b1d18a591444',
      version: 'v5',
    },
  ])
  assert.equal(actionUses.every(({ revision }) => /^[0-9a-f]{40}$/.test(revision)), true)
  assert.equal(/uses:\s*actions\/(?:checkout|setup-node)@v5\b/.test(workflow), false)
})

test('source manifest and background configure side panel action click only', () => {
  const manifest = readJson('public', 'manifest.json')
  const background = readText('src', 'background.ts')

  assert.equal(manifest.manifest_version, 3)
  assert.deepEqual(manifest.permissions, ['sidePanel', 'storage'])
  assert.equal('host_permissions' in manifest, false)
  assert.equal('content_scripts' in manifest, false)
  assert.equal(manifest.permissions.includes('unlimitedStorage'), false)
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html')
  assert.equal(manifest.background.service_worker, 'assets/background.js')
  assert.equal(manifest.background.type, 'module')
  assert.match(background, /setPanelBehavior\(\{\s*openPanelOnActionClick:\s*true\s*\}\)/)
})

test('side panel source keeps one inline Milkdown editor surface', () => {
  const html = readText('sidepanel.html')
  const sidepanel = readText('src', 'sidepanel.ts')

  assert.match(html, /<div id="editor"[^>]*><\/div>/)
  assert.equal(/<textarea\b/i.test(html), false, 'side panel must not use textarea editing')
  assert.equal(/id="preview"/i.test(html), false, 'side panel must not add a preview split pane')
  assert.match(sidepanel, /ctx\.set\(rootCtx,\s*editorRoot\)/)
  assert.match(sidepanel, /ctx\.set\(defaultValueCtx,\s*loadedSessionDraft\)/)
  assert.match(sidepanel, /\.use\(commonmark\)/)
})

test('initial editor content is blank', () => {
  const sidepanel = readText('src', 'sidepanel.ts')

  assert.match(sidepanel, /const initialMarkdown = ''/)
  assert.equal(sidepanel.includes('Prompt Draft'), false)
  assert.equal(sidepanel.includes('Write your prompt in **Markdown** here.'), false)
})

test('inline code declares accessible light and dark custom-property tokens', () => {
  const css = readText('src', 'styles.css')

  assert.match(css, /\.ProseMirror :not\(pre\) > code/)
  assert.equal(css.includes('color: #fff'), false)
  assert.match(css, /--inline-code-foreground:\s*#2e3440/)
  assert.match(css, /--inline-code-background:\s*#e5e9f0/)
  assert.match(css, /--inline-code-foreground:\s*#eceff4/)
  assert.match(css, /--inline-code-background:\s*#2e3440/)
  assert.equal(/#(?:7a2e00|fff1d6|ffe0b2|3a2612)\b/i.test(css), false)
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)/)
})

test('copy and clear actions use Milkdown markdown source APIs', () => {
  const sidepanel = readText('src', 'sidepanel.ts')

  assert.match(sidepanel, /editor\.action\(getMarkdown\(\)\)\s*\?\?\s*currentMarkdown/)
  assert.match(sidepanel, /writeClipboard\(markdown\)/)
  assert.match(sidepanel, /falling back to execCommand/)
  assert.match(sidepanel, /replaceEditorMarkdown\(''\)/)
  assert.match(sidepanel, /sessionDraft\s*=\s*''/)
})

test('session draft stays session-only while saved Library documents use local storage', () => {
  const manifest = readJson('public', 'manifest.json')
  const sidepanel = readText('src', 'sidepanel.ts')

  assert.deepEqual(manifest.permissions, ['sidePanel', 'storage'])
  assert.equal('host_permissions' in manifest, false)
  assert.equal('content_scripts' in manifest, false)
  assert.equal('content_security_policy' in manifest, false)
  assert.equal(manifest.permissions.includes('unlimitedStorage'), false)
  assert.match(sidepanel, /const sessionDraftKey = 'miniMdSessionDraft'/)
  assert.match(sidepanel, /chrome\.storage\.session\.get\(sessionDraftKey\)/)
  assert.match(sidepanel, /chrome\.storage\.session\.set\(\{\s*\[sessionDraftKey\]: markdown\s*\}\)/)
  assert.match(sidepanel, /ctx\.set\(defaultValueCtx,\s*loadedSessionDraft\)/)
  assert.match(sidepanel, /persistSessionDraft\(markdown\)/)
  assert.match(sidepanel, /persistSessionDraft\(''\)/)
  assert.match(sidepanel, /const libraryKey = 'miniMdLibrary'/)
  assert.match(sidepanel, /chrome\.storage\.local\.get\(libraryKey\)/)
  assert.match(sidepanel, /chrome\.storage\.local\.set\(\{\s*\[libraryKey\]: documents\s*\}\)/)
  assert.equal(/chrome\.storage\.sync/.test(sidepanel), false)
  assert.equal(/setAccessLevel/.test(sidepanel), false)
  assert.equal(/localStorage|sessionStorage/.test(sidepanel), false)
})

test('direct editor copy uses the same normalized markdown serializer', () => {
  const sidepanel = readText('src', 'sidepanel.ts')

  assert.match(sidepanel, /editorViewOptionsCtx/)
  assert.match(sidepanel, /clipboardTextSerializer:\s*\(slice\)\s*=>/)
  assert.match(sidepanel, /ctx\.get\(serializerCtx\)\(doc\)/)
  assert.match(sidepanel, /normalizeMarkdownForCopy\(markdown\)/)
})

test('inline code cleanup keeps markdown markers inside normal backtick code', async () => {
  const { getCompetingInlineCodeMarkNames } = await importTypeScriptModule(
    'src',
    'inline-code-cleanup.ts',
  )
  const sidepanel = readText('src', 'sidepanel.ts')
  const inlineCodeCleanup = readText('src', 'inline-code-cleanup.ts')

  assert.deepEqual(
    getCompetingInlineCodeMarkNames(['inlineCode', 'emphasis', 'strong']),
    ['emphasis', 'strong'],
  )
  assert.deepEqual(getCompetingInlineCodeMarkNames(['emphasis']), [])
  assert.equal(existsSync(path.join(root, 'src', 'inline-code-pair.ts')), false)
  assert.equal(sidepanel.includes('inlineCodePairPlugin'), false)
  assert.equal(sidepanel.includes('inline-code-pair'), false)
  assert.match(sidepanel, /inlineCodeCleanupPlugin/)
  assert.match(sidepanel, /\.use\(inlineCodeCleanupPlugin\)/)
  assert.match(inlineCodeCleanup, /removeMark\(position,\s*position \+ node\.nodeSize/)
})

test('copy markdown preserves hardbreak syntax before clipboard write', () => {
  const sidepanel = readText('src', 'sidepanel.ts')
  const copyNormalizer = readText('src', 'markdown-copy.ts')

  assert.match(
    sidepanel,
    /import\s*\{[^}]*normalizeMarkdownForCopy[^}]*\}\s*from '\.\/markdown-copy'/,
  )
  assert.match(sidepanel, /normalizeMarkdownForCopy/)
  assert.match(copyNormalizer, /<br\\s\*\\\/\?>/)
  assert.match(copyNormalizer, /\\\\_/)
  assert.match(
    sidepanel,
    /const markdown = normalizeMarkdownForCopy\(\s*editor\.action\(getMarkdown\(\)\)\s*\?\?\s*currentMarkdown,?\s*\)/,
  )
  assert.match(sidepanel, /writeClipboard\(markdown\)/)
})

test('copy markdown removes visible artifacts without flattening hardbreaks', async () => {
  const { normalizeMarkdownForCopy } = await importTypeScriptModule(
    'src',
    'markdown-copy.ts',
  )
  const milkdownSerialized = [
    '# paper\\_draft.md 작성 계획',
    '',
    '<br />',
    '',
    'figure는 가능한 한 NA\\report\\_figures\\_v2 내의 것을 사용하여라.',
    '',
    'A\\',
    'B',
    '',
    'C  ',
    'D',
    '',
    'inline <br /> break',
  ].join('\r\n')
  const expectedMarkdownText = [
    '# paper_draft.md 작성 계획',
    '',
    '',
    '',
    'figure는 가능한 한 NA\\report_figures_v2 내의 것을 사용하여라.',
    '',
    'A\\',
    'B',
    '',
    'C  ',
    'D',
    '',
    'inline break',
  ].join('\n')

  assert.equal(normalizeMarkdownForCopy(milkdownSerialized), expectedMarkdownText)
})

test('compact copy joins top-level blocks without changing block internals', async () => {
  const { compactMarkdownBlocksForCopy } = await importTypeScriptModule(
    'src',
    'markdown-copy.ts',
  )
  const issueFixture = [
    { type: 'heading', markdown: '# Test\r\n' },
    { type: 'heading', markdown: '## H2\r\n' },
    { type: 'heading', markdown: '### H3\r\n' },
    { type: 'paragraph', markdown: '테스트입니다.\r\n' },
    { type: 'paragraph', markdown: '테스트입니다.\r\n' },
  ]
  const structuralFixture = [
    { type: 'bullet_list', markdown: '- first\n\n  continuation\n' },
    {
      type: 'blockquote',
      markdown: '> quote\n>\n> ```text\n> alpha\n>\n> beta\n> ```\n',
    },
    { type: 'code_block', markdown: '```text\nouter\n\n```-like\n```\n' },
  ]

  assert.equal(
    compactMarkdownBlocksForCopy(issueFixture),
    '# Test\n## H2\n### H3\n테스트입니다.\n테스트입니다.',
  )
  assert.equal(
    compactMarkdownBlocksForCopy(structuralFixture),
    [
      '- first\n\n  continuation',
      '> quote\n>\n> ```text\n> alpha\n>\n> beta\n> ```',
      '```text\nouter\n\n```-like\n```',
    ].join('\n\n'),
  )
  assert.equal(
    compactMarkdownBlocksForCopy([
      { type: 'blockquote', markdown: '> quote\n' },
      { type: 'paragraph', markdown: 'outside\n' },
    ]),
    '> quote\n\noutside',
  )
  assert.equal(
    compactMarkdownBlocksForCopy([
      { type: 'bullet_list', markdown: '* item\n' },
      { type: 'paragraph', markdown: 'outside\n' },
    ]),
    '* item\n\noutside',
  )
  assert.equal(compactMarkdownBlocksForCopy([]), '')
})

test('side panel exposes separate canonical and compact copy actions', () => {
  const html = readText('sidepanel.html')
  const sidepanel = readText('src', 'sidepanel.ts')
  const css = readText('src', 'styles.css')

  assert.match(
    html,
    /<button\s+id="copy"[^>]*aria-label="Copy canonical Markdown"[^>]*title="Copy canonical Markdown"[^>]*>\s*Markdown\s*<\/button>/,
  )
  assert.match(
    html,
    /<button\s+id="copy-compact"[^>]*aria-label="Copy compact Markdown"[^>]*title="Copy compact Markdown"[^>]*>\s*Compact\s*<\/button>/,
  )
  assert.match(sidepanel, /requireElement<HTMLButtonElement>\('#copy-compact'\)/)
  assert.match(sidepanel, /compactMarkdownBlocksForCopy/)
  assert.match(sidepanel, /editorViewCtx/)
  assert.match(css, /@media\s*\(max-width:\s*420px\)/)
})

test('side panel exposes persistent Editor and Library workflows', () => {
  const html = readText('sidepanel.html')
  const sidepanel = readText('src', 'sidepanel.ts')

  assert.match(html, /id="tab-editor"[^>]*role="tab"[^>]*aria-controls="editor-view"/s)
  assert.match(html, /id="tab-library"[^>]*role="tab"[^>]*aria-controls="library-view"/s)
  assert.match(html, /id="save-draft"/)
  assert.match(html, /id="save-document"/)
  assert.match(html, /id="cancel-document"/)
  assert.match(html, /id="delete-document"/)
  assert.match(sidepanel, /createLibraryDocument/)
  assert.match(sidepanel, /updateLibraryDocument/)
  assert.match(sidepanel, /deleteLibraryDocument/)
  assert.match(sidepanel, /event\.stopPropagation\(\)/)
  assert.match(sidepanel, /Discard unsaved changes/)
  assert.match(sidepanel, /Delete this saved document permanently/)
})

test('built extension artifacts are load-unpacked compatible and local-only', () => {
  const dist = path.join(root, 'dist')
  const manifestPath = path.join(dist, 'manifest.json')
  const sidepanelPath = path.join(dist, 'sidepanel.html')
  const backgroundPath = path.join(dist, 'assets', 'background.js')

  assert.equal(existsSync(manifestPath), true, 'dist/manifest.json must exist')
  assert.equal(existsSync(sidepanelPath), true, 'dist/sidepanel.html must exist')
  assert.equal(existsSync(backgroundPath), true, 'dist/assets/background.js must exist')

  const manifest = readJson('dist', 'manifest.json')
  const sidepanelHtml = readText('dist', 'sidepanel.html')
  const assetNames = readdirSync(path.join(dist, 'assets'))

  assert.equal(existsSync(path.join(dist, manifest.side_panel.default_path)), true)
  assert.equal(existsSync(path.join(dist, manifest.background.service_worker)), true)
  assert.equal('content_security_policy' in manifest, false)
  assert.equal('host_permissions' in manifest, false)
  assert.equal('content_scripts' in manifest, false)
  assert.deepEqual(manifest.permissions, ['sidePanel', 'storage'])
  assert.equal(manifest.permissions.includes('unlimitedStorage'), false)
  assert.equal(/https?:\/\//i.test(sidepanelHtml), false, 'built HTML must not reference remote code')
  assert.equal(assetNames.some((name) => /^sidepanel.*\.js$/.test(name)), true)
  assert.equal(assetNames.some((name) => /^sidepanel.*\.css$/.test(name)), true)
})
