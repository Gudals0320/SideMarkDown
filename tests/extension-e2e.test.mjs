import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const evidence = path.join(root, '.omo', 'evidence', 'wave1')
const draftKey = 'miniMdSessionDraft'
const sourceMarkdown = '# 한국어 제목\n\n- 목록 항목과 `inline-code`\n\n긴토큰_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_한국어'
const issueMarkdown = '# Test\n\n## H2\n\n### H3\n\n테스트입니다.\n\n테스트입니다.\n'
const compactIssueMarkdown = '# Test\n## H2\n### H3\n테스트입니다.\n테스트입니다.'
const hardbreakMarkdown = 'First\\\nSecond\n'
const compactHardbreakMarkdown = 'First\\\nSecond'
const structuralMarkdown = [
  '# Structure',
  '',
  '- first',
  '',
  '  continuation',
  '',
  '> quote',
  '>',
  '> ```text',
  '> alpha',
  '>',
  '> beta',
  '> ```',
  '',
  '```text',
  'outer',
  '',
  '```-like',
  '```',
].join('\n')
const expectedSemanticColors = {
  light: {
    canvas: 'rgb(242, 240, 235)',
    surface: 'rgb(248, 247, 243)',
    editor: 'rgb(255, 253, 248)',
    ink: 'rgb(42, 41, 39)',
    accent: 'rgb(76, 111, 163)',
    inlineCode: { foreground: 'rgb(90, 70, 48)', background: 'rgb(241, 234, 223)' },
  },
  dark: {
    canvas: 'rgb(31, 33, 31)',
    surface: 'rgb(38, 41, 37)',
    editor: 'rgb(35, 37, 34)',
    ink: 'rgb(234, 231, 223)',
    accent: 'rgb(156, 181, 212)',
    inlineCode: { foreground: 'rgb(230, 199, 157)', background: 'rgb(58, 51, 42)' },
  },
}
const state = { context: undefined, page: undefined, profile: '', errors: [], manual: {}, worker: undefined }

const contrastRatio = (foreground, background) => {
  const luminance = (color) => {
    const channels = color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map((channel) => {
      const value = Number(channel) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

const getDraft = (page) => page.evaluate((key) => chrome.storage.session.get(key), draftKey)
const getWorkerDraft = (worker) => worker.evaluate((key) => chrome.storage.session.get(key), draftKey)

const waitForDraft = (page, expected, timeout = 5000) => page.evaluate(({ key, value, timeout }) => new Promise((resolve, reject) => {
  let listening = false
  let settled = false
  let timer
  const settle = (callback, result) => {
    if (settled) return
    settled = true
    window.clearTimeout(timer)
    if (listening) chrome.storage.onChanged.removeListener(listener)
    callback(result)
  }
  const listener = (changes, areaName) => {
    if (areaName === 'session' && changes[key]?.newValue === value) settle(resolve)
  }
  timer = window.setTimeout(() => settle(reject, new Error('Timed out waiting for session draft change.')), timeout)
  listening = true
  chrome.storage.onChanged.addListener(listener)
  chrome.storage.session.get(key).then((result) => {
    if (settled) return
    if (result[key] === value) settle(resolve)
  }, (error) => settle(reject, error))
}), { key: draftKey, value: expected, timeout })

const waitForDraftChange = (page, timeout = 5000) => page.evaluate(({ key, timeout }) => new Promise((resolve, reject) => {
  let listening = false
  let settled = false
  let timer
  const settle = (callback, result) => {
    if (settled) return
    settled = true
    window.clearTimeout(timer)
    if (listening) chrome.storage.onChanged.removeListener(listener)
    callback(result)
  }
  const listener = (changes, areaName) => {
    if (areaName === 'session' && typeof changes[key]?.newValue === 'string') settle(resolve, changes[key].newValue)
  }
  timer = window.setTimeout(() => settle(reject, new Error('Timed out waiting for session draft update.')), timeout)
  listening = true
  chrome.storage.onChanged.addListener(listener)
}), { key: draftKey, timeout })

const screenshot = async (page, name) => {
  if (process.env.CI !== 'true') await page.screenshot({ path: path.join(evidence, name), fullPage: true })
}

const assertInViewport = (rect, width, name) => assert.ok(
  rect.top >= 0 && rect.left >= 0 && rect.right <= width && rect.bottom <= 900,
  `${name} must remain wholly inside the ${width}x900 viewport`,
)

const assertStatusPlacement = async (page) => {
  const layout = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect()
    return {
      insideTopbar: document.querySelector('#status').parentElement?.classList.contains('topbar'),
      status: rect('#status'),
      topbar: rect('.topbar'),
      header: rect('.app-header'),
      editor: rect('#editor-view'),
    }
  })
  assert.equal(layout.insideTopbar, true, 'status must be in the topbar')
  assert.ok(layout.status.top >= layout.topbar.top && layout.status.bottom <= layout.topbar.bottom, 'status must remain inside the topbar')
  assert.ok(layout.status.bottom <= layout.editor.top, 'status must not overlap editor')
  assert.ok(layout.header.bottom <= layout.editor.top, 'header must not overlap editor')
  return layout
}

describe('unpacked SideMarkDown extension', { concurrency: false }, () => {
  before(async () => {
    mkdirSync(evidence, { recursive: true })
    state.profile = mkdtempSync(path.join(os.tmpdir(), 'sidemarkdown-wave1-'))
    state.context = await chromium.launchPersistentContext(state.profile, {
      headless: false,
      viewport: { width: 375, height: 900 },
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    })
    const worker = state.context.serviceWorkers()[0] ?? await state.context.waitForEvent('serviceworker')
    state.worker = worker
    const workerUrl = new URL(worker.url())
    const origin = `${workerUrl.protocol}//${workerUrl.host}`
    await state.context.grantPermissions(['clipboard-read', 'clipboard-write'])
    state.page = await state.context.newPage()
    state.page.on('pageerror', (error) => state.errors.push(`page: ${error.message}`))
    state.page.on('requestfailed', (request) => state.errors.push(`request: ${request.url()}`))
    worker.on('console', (message) => {
      if (message.type() === 'error') state.errors.push(`worker: ${message.text()}`)
    })
    await state.page.goto(`${origin}/sidepanel.html`)
    await state.page.locator('.ProseMirror').waitFor()
    await state.page.evaluate(
      ({ key, markdown }) => chrome.storage.session.set({ [key]: markdown }),
      { key: draftKey, markdown: sourceMarkdown },
    )
    await state.page.reload()
    await state.page.locator('.ProseMirror code').waitFor()
  })

  after(async () => {
    try {
      if (state.context) await state.context.close()
    } finally {
      const profile = state.profile
      if (profile) rmSync(profile, { recursive: true, force: true })
      writeFileSync(path.join(evidence, 'manual-qa.json'), JSON.stringify({ observations: state.manual, errors: state.errors }, null, 2))
      writeFileSync(path.join(evidence, 'cleanup-receipt.json'), JSON.stringify({ profile, removed: !existsSync(profile), errors: state.errors }, null, 2))
    }
  })

  test('uses artifacts rebuilt after the extension sources', () => {
    const builtAt = statSync(path.join(dist, 'sidepanel.html')).mtimeMs
    const sourceAt = Math.max(statSync(path.join(root, 'sidepanel.html')).mtimeMs, statSync(path.join(root, 'src', 'styles.css')).mtimeMs)
    assert.ok(builtAt >= sourceAt, 'dist/sidepanel.html must be rebuilt after sidepanel sources')
  })

  test('renders Korean content without tofu or horizontal clipping', async () => {
    const editor = state.page.locator('.ProseMirror')
    await editor.waitFor()
    assert.match(await editor.textContent(), /한국어 제목/)
    assert.equal((await editor.textContent()).includes('□'), false)
    assert.equal(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth), true)
    await screenshot(state.page, 'manual-korean-375x900.png')
  })

  test('uses exact semantic colors without Nord runtime classes in light and dark', async () => {
    const inlineCode = state.page.locator('.ProseMirror :not(pre) > code').first()
    for (const colorScheme of ['light', 'dark']) {
      await state.page.emulateMedia({ colorScheme })
      const colors = await inlineCode.evaluate((node) => {
        let backgroundNode = node
        while (backgroundNode) {
          const background = getComputedStyle(backgroundNode).backgroundColor
          if (background !== 'rgba(0, 0, 0, 0)') {
            return { foreground: getComputedStyle(node).color, background }
          }
          backgroundNode = backgroundNode.parentElement
        }
        throw new Error('Inline code has no rendered background.')
      })
      const ratio = contrastRatio(colors.foreground, colors.background)
      const surface = await state.page.evaluate(() => {
        const selectedTab = document.querySelector('.tab[aria-selected="true"]')
        const nordRuntimeClass = ['milkdown', 'theme', 'nord'].join('-')
        return {
          canvas: getComputedStyle(document.documentElement).backgroundColor,
          surface: getComputedStyle(document.querySelector('.app-header')).backgroundColor,
          editor: getComputedStyle(document.querySelector('.ProseMirror')).backgroundColor,
          ink: getComputedStyle(document.querySelector('.ProseMirror')).color,
          accent: selectedTab ? getComputedStyle(selectedTab).borderBottomColor : '',
          hasNordRuntimeClass: Boolean(document.querySelector(`[class*="${nordRuntimeClass}"]`)),
        }
      })
      const expected = expectedSemanticColors[colorScheme]
      state.manual[`${colorScheme}SemanticTokens`] = { ...surface, inlineCode: colors, ratio }
      assert.deepEqual(colors, expected.inlineCode)
      assert.equal(surface.canvas, expected.canvas)
      assert.equal(surface.surface, expected.surface)
      assert.equal(surface.editor, expected.editor)
      assert.equal(surface.ink, expected.ink)
      assert.equal(surface.accent, expected.accent)
      assert.equal(surface.hasNordRuntimeClass, false)
      assert.ok(ratio >= 4.5, `${colorScheme} inline-code contrast is below 4.5:1`)
      if (colorScheme === 'dark') {
        assert.notEqual(
          colors.background,
          surface.editor,
          'dark inline-code background must differ from the editor background',
        )
      }
      await screenshot(state.page, `manual-inline-code-${colorScheme}-375x900.png`)
    }
    await state.page.emulateMedia({ colorScheme: 'light' })
  })

  test('reaches the editor by Tab with a visible 2px focus outline', async () => {
    await state.page.locator('#save-draft').focus()
    await state.page.keyboard.press('Tab')
    const outline = await state.page.locator('.ProseMirror').evaluate((node) => {
      const style = getComputedStyle(node)
      return { focused: document.activeElement === node, width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor }
    })
    assert.equal(outline.focused, true, 'Tab must reach the editor')
    assert.equal(outline.width, '2px', 'editor focus outline must be 2px')
    assert.equal(outline.style, 'solid', 'editor focus outline must be solid')
    assert.notEqual(outline.color, 'rgba(0, 0, 0, 0)', 'editor focus outline must be visible')
    state.manual.focus = outline
    await screenshot(state.page, 'manual-focus-375x900.png')
  })

  test('keeps action buttons at least 32px high', async () => {
    for (const button of ['#copy', '#copy-compact', '#clear']) {
      assert.ok((await state.page.locator(button).boundingBox()).height >= 32, `${button} is shorter than 32px`)
    }
  })

  test('copies canonical Markdown or compact prompt text without corrupting structural blocks', async () => {
    const page = state.page

    try {
      const cleared = waitForDraft(page, '')
      await page.locator('#clear').click()
      await cleared
      const expectedDraft = waitForDraft(page, issueMarkdown)
      const editor = page.locator('.ProseMirror')
      await editor.focus()
      const lines = ['# Test', '## H2', '### H3', '테스트입니다.', '테스트입니다.']
      for (const [index, line] of lines.entries()) {
        await editor.pressSequentially(line)
        if (index < lines.length - 1) await editor.press('Enter')
      }
      await expectedDraft
      assert.deepEqual(
        await editor.locator(':scope > *').evaluateAll((nodes) => nodes.map((node) => node.tagName)),
        ['H1', 'H2', 'H3', 'P', 'P'],
      )

      await page.locator('#copy').click()
      await page.getByRole('status').filter({ hasText: 'Copied' }).waitFor()
      assert.equal(
        (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n?/g, '\n'),
        issueMarkdown,
      )

      await editor.focus()
      await editor.press('Control+A')
      await editor.press('Control+C')
      assert.equal(
        (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n?/g, '\n'),
        issueMarkdown,
      )

      await page.locator('#copy-compact').click()
      await page.getByRole('status').filter({ hasText: 'Copied' }).waitFor()
      const compactClipboard = await page.evaluate(async () => {
        const items = await navigator.clipboard.read()
        return {
          text: await navigator.clipboard.readText(),
          types: items.flatMap((item) => item.types),
        }
      })
      assert.deepEqual(compactClipboard.types, ['text/plain'])
      assert.equal(compactClipboard.text.replace(/\r\n?/g, '\n'), compactIssueMarkdown)
      const textarea = await page.evaluate(() => {
        const node = document.createElement('textarea')
        node.id = 'compact-paste-target'
        document.body.appendChild(node)
        node.focus()
        return node.id
      })
      await page.locator(`#${textarea}`).press('Control+V')
      assert.equal(
        (await page.locator(`#${textarea}`).inputValue()).replace(/\r\n?/g, '\n'),
        compactIssueMarkdown,
      )
      await page.locator(`#${textarea}`).evaluate((node) => node.remove())
      await screenshot(page, 'manual-compact-copy-375x900.png')

      await editor.evaluate((node) => {
        const range = document.createRange()
        range.selectNodeContents(node)
        range.collapse(false)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        node.focus()
      })
      await editor.press('Enter')
      await page.waitForFunction(() => {
        const lastBlock = document.querySelector('.ProseMirror')?.lastElementChild
        return lastBlock?.tagName === 'P' && lastBlock.textContent === ''
      })
      await page.locator('#copy-compact').click()
      await page.getByRole('status').filter({ hasText: 'Copied' }).waitFor()
      assert.equal(
        (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n?/g, '\n'),
        compactIssueMarkdown,
      )

      await page.evaluate(
        ({ key, markdown }) => chrome.storage.session.set({ [key]: markdown }),
        { key: draftKey, markdown: structuralMarkdown },
      )
      await page.reload()
      await page.locator('.ProseMirror blockquote pre').waitFor()
      await page.locator('#copy-compact').click()
      await page.getByRole('status').filter({ hasText: 'Copied' }).waitFor()
      const structuralClipboard = (
        await page.evaluate(() => navigator.clipboard.readText())
      ).replace(/\r\n?/g, '\n')
      assert.match(structuralClipboard, /[*-] first\n\n  continuation/)
      assert.match(structuralClipboard, /> ```text\n> alpha\n>\n> beta\n> ```/)
      assert.match(structuralClipboard, /````text\nouter\n\n```-like\n````/)

      await page.evaluate(
        ({ key, markdown }) => chrome.storage.session.set({ [key]: markdown }),
        { key: draftKey, markdown: structuralClipboard },
      )
      await page.reload()
      assert.equal(await page.locator('.ProseMirror > ul').count(), 1)
      assert.equal(await page.locator('.ProseMirror > blockquote').count(), 1)
      assert.equal(await page.locator('.ProseMirror > blockquote pre').count(), 1)
      assert.equal(await page.locator('.ProseMirror > pre').count(), 1)
      assert.match(await page.locator('.ProseMirror > pre').textContent(), /outer\n\n```-like/)
    } finally {
      await page.evaluate(
        ({ key, markdown }) => chrome.storage.session.set({ [key]: markdown }),
        { key: draftKey, markdown: sourceMarkdown },
      )
      await page.reload()
      await page.locator('.ProseMirror code').waitFor()
    }
  })

  test('keeps structural containers separate from following paragraphs in compact copy', async () => {
    const page = state.page
    const cases = [
      {
        markdown: '> quoted paragraph\n\nOutside paragraph',
        expectedTags: ['BLOCKQUOTE', 'P'],
      },
      {
        markdown: '- list item\n\nOutside paragraph',
        expectedTags: ['UL', 'P'],
      },
    ]

    try {
      for (const fixture of cases) {
        await page.evaluate(
          ({ key, markdown }) => chrome.storage.session.set({ [key]: markdown }),
          { key: draftKey, markdown: fixture.markdown },
        )
        await page.reload()
        assert.deepEqual(
          await page.locator('.ProseMirror > *').evaluateAll((nodes) =>
            nodes.map((node) => node.tagName),
          ),
          fixture.expectedTags,
        )
        await page.locator('#copy-compact').click()
        const compact = (
          await page.evaluate(() => navigator.clipboard.readText())
        ).replace(/\r\n?/g, '\n')
        assert.match(compact, /\n\nOutside paragraph$/)
        await page.evaluate(
          ({ key, markdown }) => chrome.storage.session.set({ [key]: markdown }),
          { key: draftKey, markdown: compact },
        )
        await page.reload()
        assert.deepEqual(
          await page.locator('.ProseMirror > *').evaluateAll((nodes) =>
            nodes.map((node) => node.tagName),
          ),
          fixture.expectedTags,
        )
      }
    } finally {
      await page.evaluate(
        ({ key, markdown }) => chrome.storage.session.set({ [key]: markdown }),
        { key: draftKey, markdown: sourceMarkdown },
      )
      await page.reload()
      await page.locator('.ProseMirror code').waitFor()
    }
  })

  test('preserves Shift+Enter hard breaks in canonical and compact clipboard paths', async () => {
    const page = state.page

    try {
      const cleared = waitForDraft(page, '')
      await page.locator('#clear').click()
      await cleared
      const expectedDraft = waitForDraft(page, hardbreakMarkdown)
      const editor = page.locator('.ProseMirror')
      await editor.focus()
      await editor.pressSequentially('First')
      await editor.press('Shift+Enter')
      await editor.pressSequentially('Second')
      await expectedDraft
      assert.deepEqual(
        await editor.locator(':scope > *').evaluateAll((nodes) =>
          nodes.map((node) => node.tagName),
        ),
        ['P'],
      )
      assert.equal(await editor.locator('[data-type="hardbreak"]').count(), 1)

      await page.locator('#copy').click()
      assert.equal(
        (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n?/g, '\n'),
        hardbreakMarkdown,
      )
      await editor.focus()
      await editor.press('Control+A')
      await editor.press('Control+C')
      assert.equal(
        (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n?/g, '\n'),
        hardbreakMarkdown,
      )
      await page.locator('#copy-compact').click()
      const compact = (
        await page.evaluate(() => navigator.clipboard.readText())
      ).replace(/\r\n?/g, '\n')
      assert.equal(compact, compactHardbreakMarkdown)

      await page.evaluate(
        ({ key, markdown }) => chrome.storage.session.set({ [key]: markdown }),
        { key: draftKey, markdown: compact },
      )
      await page.reload()
      assert.equal(await page.locator('.ProseMirror > p').count(), 1)
      assert.equal(await page.locator('.ProseMirror [data-type="hardbreak"]').count(), 1)
    } finally {
      await page.evaluate(
        ({ key, markdown }) => chrome.storage.session.set({ [key]: markdown }),
        { key: draftKey, markdown: sourceMarkdown },
      )
      await page.reload()
      await page.locator('.ProseMirror code').waitFor()
    }
  })

  test('copies source, restores it in a second page, and clears session state', async () => {
    const page = state.page
    const changedDraft = waitForDraftChange(page)
    await page.locator('.ProseMirror').press('End')
    await page.locator('.ProseMirror').pressSequentially(' 추가')
    const pageDraft = await changedDraft
    const stored = await getDraft(page)
    assert.equal(stored[draftKey], pageDraft)
    assert.equal((await getWorkerDraft(state.worker))[draftKey], pageDraft)
    await page.locator('#copy').click()
    await page.getByRole('status').filter({ hasText: 'Copied' }).waitFor()
    state.manual.copiedStatus = await assertStatusPlacement(page)
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    assert.equal(
      copied.replace(/\r\n?/g, '\n'),
      stored[draftKey].replace(/\r\n?/g, '\n').replace(/\\_/g, '_'),
    )
    assert.match(copied, /한국어 제목/)
    await screenshot(page, 'manual-copied-375x900.png')
    const secondPage = await state.context.newPage()
    await secondPage.goto(page.url())
    await secondPage.locator('.ProseMirror').getByText('한국어 제목').waitFor()
    await secondPage.close()
    const cleared = waitForDraft(page, '')
    await page.locator('#clear').click()
    await cleared
    await page.getByRole('status').filter({ hasText: 'Cleared' }).waitFor()
    state.manual.clearedStatus = await assertStatusPlacement(page)
    assert.equal((await getDraft(page))[draftKey], '')
    assert.equal((await getWorkerDraft(state.worker))[draftKey], '')
    await screenshot(page, 'manual-cleared-375x900.png')
    await page.reload()
    assert.equal(await page.locator('.ProseMirror').textContent(), '')
  })

  test('places status inside the header without covering the editor at every viewport', async () => {
    const page = state.page
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme })
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        const layout = await page.evaluate(() => {
          const header = document.querySelector('.app-header').getBoundingClientRect()
          const editor = document.querySelector('#editor-view').getBoundingClientRect()
          const controls = ['#status', '#copy', '#copy-compact', '#clear', '#save-draft'].map((selector) => ({
            selector,
            rect: document.querySelector(selector).getBoundingClientRect(),
          }))
          return {
            header,
            editor,
            controls,
            headerFits: document.querySelector('.app-header').scrollWidth <= document.querySelector('.app-header').clientWidth,
          }
        })
        assertInViewport(layout.header, width, 'header')
        assertInViewport(layout.editor, width, 'editor')
        assert.equal(layout.headerFits, true, `header overflows at ${width}px in ${colorScheme} mode`)
        for (const control of layout.controls) assertInViewport(control.rect, width, control.selector)
        await screenshot(page, `manual-toolbar-${colorScheme}-${width}x900.png`)
      }
    }
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 375, height: 900 })
  })

  test('reports no page, worker, or request errors', async () => {
    const page = state.page; const raceValue = '__wait_for_draft_race__'
    await page.evaluate(({ key, value }) => {
      const originalGet = chrome.storage.session.get.bind(chrome.storage.session)
      window.__restoreWaitForDraftGet = () => { chrome.storage.session.get = originalGet; delete window.__restoreWaitForDraftGet }
      chrome.storage.session.get = async (keys) => {
        const stale = await originalGet(keys)
        await chrome.storage.session.set({ [key]: value })
        return stale
      }
    }, { key: draftKey, value: raceValue })
    try { await waitForDraft(page, raceValue, 100) } finally { await page.evaluate(() => window.__restoreWaitForDraftGet()) }
    assert.equal((await getDraft(page))[draftKey], raceValue, 'the deterministic race must update session storage')
    assert.equal(await page.evaluate(() => chrome.storage.onChanged.hasListeners()), false, 'waitForDraft race success must remove its listener')
    await assert.rejects(waitForDraft(state.page, '__listener_cleanup_timeout__', 25), /Timed out waiting for session draft change/)
    assert.equal(await state.page.evaluate(() => chrome.storage.onChanged.hasListeners()), false, 'waitForDraft timeout must remove its listener')
    await assert.rejects(waitForDraftChange(state.page, 25), /Timed out waiting for session draft update/)
    assert.equal(await state.page.evaluate(() => chrome.storage.onChanged.hasListeners()), false, 'waitForDraftChange timeout must remove its listener')
    writeFileSync(path.join(evidence, 'runtime-errors.json'), JSON.stringify(state.errors, null, 2))
    assert.deepEqual(state.errors, [])
  })
})
