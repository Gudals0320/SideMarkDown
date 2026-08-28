import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const evidence = path.join(root, '.omo', 'evidence', 'issue-5')
const sessionDraftKey = 'miniMdSessionDraft'
const libraryKey = 'miniMdLibrary'
const titledMarkdown = '# Saved title\nFirst preview line\nSecond preview line'
const rapidTypedMarkdown = '빠른 중복 저장 회귀 문서\n'
const untitledMarkdown = 'Untitled first line\nUntitled second line'
const longMarkdown = `# Restart proof\n${'가나다라마바사'.repeat(520)}`
const state = {
  context: undefined,
  page: undefined,
  profile: '',
  origin: '',
  errors: [],
  duplicateIds: [],
  updatedDocumentId: '',
}

const launchExtension = async (profile) => {
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 375, height: 900 },
    timezoneId: 'UTC',
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  })
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const workerUrl = new URL(worker.url())
  const origin = `${workerUrl.protocol}//${workerUrl.host}`
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  page.on('pageerror', (error) => state.errors.push(`page: ${error.message}`))
  page.on('requestfailed', (request) => state.errors.push(`request: ${request.url()}`))
  worker.on('console', (message) => {
    if (message.type() === 'error') state.errors.push(`worker: ${message.text()}`)
  })
  await page.goto(`${origin}/sidepanel.html`)
  await page.locator('.ProseMirror').waitFor()
  return { context, page, origin }
}

const getLibrary = (page) =>
  page.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key)
    return stored[key] ?? []
  }, libraryKey)

const waitForLibraryLength = (page, expectedLength, timeout = 5_000) =>
  page.evaluate(
    ({ key, expectedLength, timeout }) =>
      new Promise((resolve, reject) => {
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
        const matches = (value) =>
          Array.isArray(value) && value.length === expectedLength
        const listener = (changes, areaName) => {
          if (areaName === 'local' && matches(changes[key]?.newValue)) {
            settle(resolve, changes[key].newValue)
          }
        }
        timer = window.setTimeout(
          () => settle(reject, new Error('Timed out waiting for Library size change.')),
          timeout,
        )
        listening = true
        chrome.storage.onChanged.addListener(listener)
        chrome.storage.local.get(key).then(
          (stored) => {
            if (matches(stored[key])) settle(resolve, stored[key])
          },
          (error) => settle(reject, error),
        )
      }),
    { key: libraryKey, expectedLength, timeout },
  )

const setDraft = async (page, markdown) => {
  await page.evaluate(
    ({ key, markdown }) => chrome.storage.session.set({ [key]: markdown }),
    { key: sessionDraftKey, markdown },
  )
  await page.reload()
  await page.locator('.ProseMirror').waitFor()
}

const clickAndHandleDialog = async (page, locator, action) => {
  const dialogPromise = page.waitForEvent('dialog')
  const clickPromise = locator.click()
  const dialog = await dialogPromise
  const message = dialog.message()
  await dialog[action]()
  await clickPromise
  return message
}

const screenshot = async (page, name) => {
  if (process.env.CI !== 'true') {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )
    await page.screenshot({ path: path.join(evidence, name), fullPage: true })
  }
}

describe('persistent prompt Library', { concurrency: false }, () => {
  before(async () => {
    mkdirSync(evidence, { recursive: true })
    state.profile = mkdtempSync(path.join(os.tmpdir(), 'sidemarkdown-library-'))
    const launched = await launchExtension(state.profile)
    state.context = launched.context
    state.page = launched.page
    state.origin = launched.origin
    await state.page.evaluate(
      ({ sessionKey, localKey }) =>
        Promise.all([
          chrome.storage.session.remove(sessionKey),
          chrome.storage.local.remove(localKey),
        ]),
      { sessionKey: sessionDraftKey, localKey: libraryKey },
    )
    await state.page.reload()
    await state.page.locator('.ProseMirror').waitFor()
  })

  after(async () => {
    try {
      if (state.context) await state.context.close()
    } finally {
      const profile = state.profile
      if (profile) rmSync(profile, { recursive: true, force: true })
      writeFileSync(
        path.join(evidence, 'runtime-errors.json'),
        JSON.stringify(state.errors, null, 2),
      )
      writeFileSync(
        path.join(evidence, 'cleanup-receipt.json'),
        JSON.stringify({ profile, removed: !existsSync(profile) }, null, 2),
      )
    }
  })

  test('keeps the session draft separate while Editor and Library tabs switch', async () => {
    // Given
    await setDraft(state.page, titledMarkdown)

    // When
    await state.page.locator('#tab-library').click()

    // Then
    assert.equal(await state.page.locator('.library-card').count(), 0)
    assert.equal(await state.page.locator('#tab-library').getAttribute('aria-selected'), 'true')
    await screenshot(state.page, 'library-empty-light-375x900.png')
    await state.page.locator('#tab-editor').click()
    assert.match(await state.page.locator('.ProseMirror').textContent(), /Saved title/)
    assert.equal((await getLibrary(state.page)).length, 0)
  })

  test('persists live typed Markdown in both rapid duplicate saves', async () => {
    try {
      // Given
      await state.page.locator('#clear').click()
      const editor = state.page.locator('.ProseMirror')
      await editor.focus()
      await state.page.keyboard.insertText(rapidTypedMarkdown.trimEnd())

      // When
      const documentsReady = waitForLibraryLength(state.page, 2)
      await state.page.evaluate(() => {
        const saveButton = document.querySelector('#save-draft')
        saveButton.click()
        saveButton.click()
      })
      const documents = await documentsReady

      // Then
      assert.equal(await editor.textContent(), rapidTypedMarkdown.trimEnd())
      assert.equal(documents[0].markdown, rapidTypedMarkdown)
      assert.equal(documents[1].markdown, rapidTypedMarkdown)
      assert.notEqual(documents[0].id, documents[1].id)
    } finally {
      await state.page.evaluate((key) => chrome.storage.local.remove(key), libraryKey)
      await setDraft(state.page, titledMarkdown)
    }
  })

  test('creates duplicate cards without leaving or clearing the draft Editor', async () => {
    // Given
    await state.page.evaluate((key) => {
      const originalSet = chrome.storage.local.set.bind(chrome.storage.local)
      let releaseFirstWrite
      const payloadLengths = []
      chrome.storage.local.set = async (items) => {
        payloadLengths.push(Array.isArray(items[key]) ? items[key].length : -1)
        if (payloadLengths.length === 1) {
          await new Promise((resolve) => {
            releaseFirstWrite = resolve
          })
        }
        return originalSet(items)
      }
      window.__libraryWriteProbe = {
        payloadLengths: () => [...payloadLengths],
        releaseFirstWrite: () => releaseFirstWrite?.(),
        restore: () => {
          chrome.storage.local.set = originalSet
          delete window.__libraryWriteProbe
        },
      }
    }, libraryKey)

    // When
    const saveButton = state.page.locator('#save-draft')
    let documents
    try {
      await saveButton.click()
      await saveButton.click()
      const payloadLengthsBeforeRelease = await state.page.evaluate(() =>
        window.__libraryWriteProbe.payloadLengths(),
      )
      await state.page.evaluate(() => window.__libraryWriteProbe.releaseFirstWrite())

      // Then
      assert.deepEqual(
        payloadLengthsBeforeRelease,
        [1],
        'only the first Library write may begin before it commits',
      )
      documents = await waitForLibraryLength(state.page, 2)
    } finally {
      await state.page.evaluate(() => {
        const probe = window.__libraryWriteProbe
        probe?.releaseFirstWrite()
        probe?.restore()
      })
    }
    assert.ok(documents)
    assert.equal(await state.page.locator('#tab-editor').getAttribute('aria-selected'), 'true')
    assert.match(await state.page.locator('.ProseMirror').textContent(), /Saved title/)
    assert.equal(documents[0].markdown, titledMarkdown)
    assert.equal(documents[1].markdown, titledMarkdown)
    assert.notEqual(documents[0].id, documents[1].id)
    state.duplicateIds = documents.map(({ id }) => id)
    await state.page.locator('#tab-library').click()
    assert.equal(await state.page.locator('.library-card').count(), 2)
    assert.equal(
      await state.page.locator('.library-card').first().locator('.library-card-title').textContent(),
      'Saved title',
    )
    assert.match(
      await state.page.locator('.library-card').first().locator('.library-card-preview').textContent(),
      /First preview line/,
    )
    await screenshot(state.page, 'library-titled-light-375x900.png')
  })

  test('shows untitled preview and copies the exact saved Markdown from the card', async () => {
    // Given
    await state.page.locator('#tab-editor').click()
    await setDraft(state.page, untitledMarkdown)
    const saved = waitForLibraryLength(state.page, 3)
    await state.page.locator('#save-draft').click()
    await saved
    await state.page.locator('#tab-library').click()
    const firstCard = state.page.locator('.library-card').first()

    // When
    await firstCard.locator('.library-card-copy').click()

    // Then
    assert.equal(await firstCard.locator('.library-card-title').count(), 0)
    assert.match(
      await firstCard.locator('.library-card-preview').textContent(),
      /^Untitled first line/,
    )
    const cardContent = await state.page.locator('.library-card').evaluateAll((cards) =>
      cards.map((card) => ({
        title: card.querySelector('.library-card-title')?.textContent,
        metadata: card.querySelector('time')?.textContent,
        preview: card.querySelector('.library-card-preview')?.textContent,
        copy: card.querySelector('.library-card-copy-action')?.textContent?.trim(),
      })),
    )
    assert.deepEqual(cardContent.map(({ title, preview, copy }) => ({ title, preview, copy })), [
      { title: undefined, preview: 'Untitled first line\nUntitled second line', copy: 'Copy' },
      { title: 'Saved title', preview: 'First preview line\nSecond preview line', copy: 'Copy' },
      { title: 'Saved title', preview: 'First preview line\nSecond preview line', copy: 'Copy' },
    ])
    for (const { metadata } of cardContent) assert.match(metadata ?? '', /^Updated [A-Z][a-z]{2} \d{1,2}, \d{4}$/)
    assert.equal(
      (await state.page.evaluate(() => navigator.clipboard.readText())).replace(
        /\r\n?/g,
        '\n',
      ),
      untitledMarkdown,
    )
    await screenshot(state.page, 'library-untitled-light-375x900.png')
  })

  test('edits one card without copying or overwriting the session draft', async () => {
    // Given
    const firstCard = state.page.locator('.library-card').first()
    const selectedId = await firstCard.getAttribute('data-document-id')
    await state.page.evaluate(() => navigator.clipboard.writeText('__edit_sentinel__'))

    // When
    await firstCard.hover()
    await firstCard.locator('.library-card-edit').click()

    // Then
    assert.equal(await state.page.evaluate(() => navigator.clipboard.readText()), '__edit_sentinel__')
    assert.equal(await state.page.locator('#tab-editor').getAttribute('aria-selected'), 'true')
    assert.match(await state.page.locator('#editor-mode').textContent(), /Editing saved document/)
    await screenshot(state.page, 'library-editing-light-375x900.png')
    assert.equal(
      (await state.page.evaluate((key) => chrome.storage.session.get(key), sessionDraftKey))[
        sessionDraftKey
      ],
      untitledMarkdown,
    )

    await state.page.locator('.ProseMirror').press('End')
    await state.page.locator('.ProseMirror').pressSequentially(' updated')
    const beforeUpdate = await getLibrary(state.page)
    await state.page.locator('#save-document').click()
    const afterUpdate = await getLibrary(state.page)
    assert.equal(afterUpdate.length, beforeUpdate.length)
    assert.equal(afterUpdate[0].id, selectedId)
    assert.match(afterUpdate[0].markdown, /updated/)
    assert.ok(afterUpdate[0].updatedAt >= beforeUpdate[0].updatedAt)
    assert.equal(await state.page.locator('#tab-editor').getAttribute('aria-selected'), 'true')
    assert.equal(await state.page.locator('#editor-mode').textContent(), 'Editing saved document — Saved')
    state.updatedDocumentId = selectedId

    await state.page.locator('#tab-library').click()
    const beforeCopy = await getLibrary(state.page)
    await state.page.locator('.library-card').first().locator('.library-card-copy').click()
    const afterCopy = await getLibrary(state.page)
    assert.deepEqual(afterCopy, beforeCopy)
  })

  test('cancels saved edits and confirms before discarding changed tab navigation', async () => {
    // Given
    const targetCard = state.page.locator(
      `.library-card[data-document-id="${state.updatedDocumentId}"]`,
    )
    await targetCard.hover()
    await targetCard.locator('.library-card-edit').click()
    const storedBefore = await getLibrary(state.page)
    await state.page.locator('.ProseMirror').press('End')
    await state.page.locator('.ProseMirror').pressSequentially(' discarded')

    // When
    const dismissedMessage = await clickAndHandleDialog(
      state.page,
      state.page.locator('#tab-library'),
      'dismiss',
    )

    // Then
    assert.match(dismissedMessage, /discard/i)
    assert.equal(await state.page.locator('#tab-editor').getAttribute('aria-selected'), 'true')
    assert.deepEqual(await getLibrary(state.page), storedBefore)

    const acceptedMessage = await clickAndHandleDialog(
      state.page,
      state.page.locator('#tab-library'),
      'accept',
    )
    assert.match(acceptedMessage, /discard/i)
    assert.equal(await state.page.locator('#tab-library').getAttribute('aria-selected'), 'true')
    assert.deepEqual(await getLibrary(state.page), storedBefore)
    await state.page.locator('#tab-editor').click()
    assert.match(await state.page.locator('.ProseMirror').textContent(), /Untitled first line/)

    await state.page.locator('#tab-library').click()
    await targetCard.hover()
    await targetCard.locator('.library-card-edit').click()
    await state.page.locator('.ProseMirror').press('End')
    await state.page.locator('.ProseMirror').pressSequentially(' cancel')
    await state.page.locator('#cancel-document').click()
    assert.equal(await state.page.locator('#tab-library').getAttribute('aria-selected'), 'true')
    assert.deepEqual(await getLibrary(state.page), storedBefore)
  })

  test('requires confirmation before deleting one saved document', async () => {
    // Given
    const targetCard = state.page.locator(
      `.library-card[data-document-id="${state.updatedDocumentId}"]`,
    )
    await targetCard.hover()
    await targetCard.locator('.library-card-edit').click()
    const beforeDelete = await getLibrary(state.page)

    // When / Then: cancel
    const dismissedMessage = await clickAndHandleDialog(
      state.page,
      state.page.locator('#delete-document'),
      'dismiss',
    )
    assert.match(dismissedMessage, /delete/i)
    assert.match(await state.page.locator('#editor-mode').textContent(), /Editing saved document/)
    assert.deepEqual(await getLibrary(state.page), beforeDelete)

    // When / Then: confirm
    const deleted = waitForLibraryLength(state.page, beforeDelete.length - 1)
    const acceptedMessage = await clickAndHandleDialog(
      state.page,
      state.page.locator('#delete-document'),
      'accept',
    )
    await deleted
    assert.match(acceptedMessage, /delete/i)
    assert.equal(await state.page.locator('#tab-library').getAttribute('aria-selected'), 'true')
    assert.equal(
      (await getLibrary(state.page)).some(({ id }) => id === state.updatedDocumentId),
      false,
    )
    assert.equal(
      (await state.page.evaluate((key) => chrome.storage.session.get(key), sessionDraftKey))[
        sessionDraftKey
      ],
      untitledMarkdown,
    )
  })

  test('keeps a 3000-plus-character document after a complete Chrome restart', async () => {
    // Given
    await state.page.locator('#tab-editor').click()
    await setDraft(state.page, longMarkdown)
    const beforeSave = await getLibrary(state.page)
    const saved = waitForLibraryLength(state.page, beforeSave.length + 1)
    await state.page.locator('#save-draft').click()
    await saved
    await state.context.close()

    // When
    const relaunched = await launchExtension(state.profile)
    state.context = relaunched.context
    state.page = relaunched.page
    state.origin = relaunched.origin
    await state.page.locator('#tab-library').click()
    const restartCard = state.page.locator('.library-card').first()
    await restartCard.locator('.library-card-copy').click()

    // Then
    assert.ok(longMarkdown.length > 3_000)
    assert.equal(await restartCard.locator('.library-card-title').textContent(), 'Restart proof')
    assert.equal(
      (await state.page.evaluate(() => navigator.clipboard.readText())).replace(
        /\r\n?/g,
        '\n',
      ),
      longMarkdown,
    )
    assert.equal(
      (await state.page.evaluate((key) => chrome.storage.session.get(key), sessionDraftKey))[
        sessionDraftKey
      ],
      undefined,
    )
    await screenshot(state.page, 'library-restarted-light-375x900.png')
  })

  test('keeps Library controls in view in light and dark at all target widths', async () => {
    // Given / When / Then
    for (const colorScheme of ['light', 'dark']) {
      await state.page.emulateMedia({ colorScheme })
      for (const width of [375, 768, 1280]) {
        await state.page.setViewportSize({ width, height: 900 })
        const layout = await state.page.evaluate(() => ({
          bodyFits: document.body.scrollWidth <= document.body.clientWidth,
          headerFits:
            document.querySelector('.app-header').scrollWidth <=
            document.querySelector('.app-header').clientWidth,
          cardFits: [...document.querySelectorAll('.library-card')].every(
            (card) => card.scrollWidth <= card.clientWidth,
          ),
        }))
        assert.deepEqual(layout, {
          bodyFits: true,
          headerFits: true,
          cardFits: true,
        })
        await screenshot(
          state.page,
          `library-${colorScheme}-${width}x900.png`,
        )
      }
    }
    assert.deepEqual(state.errors, [])
  })

  test('keeps the saved-document action hierarchy compact, primary, and durable across widths', async () => {
    // Given
    await state.page.evaluate(() => chrome.storage.local.set({ miniMdLibrary: [{ id: '11111111-1111-4111-8111-111111111111', markdown: '# Shell fixture', createdAt: 1, updatedAt: 1 }] }))
    await state.page.reload()
    await state.page.locator('.ProseMirror').waitFor()
    await state.page.locator('#tab-library').click()
    const edit = state.page.locator('.library-card-edit').first()
    const expectedIdleEditOpacity = await state.page.evaluate(() =>
      '1',
    )
    assert.equal(await edit.evaluate((node) => getComputedStyle(node).opacity), expectedIdleEditOpacity)
    await edit.click()

    // When / Then
    for (const width of [375, 768, 1280]) {
      await state.page.setViewportSize({ width, height: 900 })
      await state.page.mouse.move(0, 0)
      const layout = await state.page.evaluate(() => {
        const toolbar = document.querySelector('#editor-actions')
        const topbar = document.querySelector('.topbar')
        const editor = document.querySelector('#editor-view')
        const status = document.querySelector('#status')
        const action = (id) => document.querySelector(id)
        const toRect = (element) => {
          const { x, y, width, height, top, right, bottom, left } = element.getBoundingClientRect()
          return { x, y, width, height, top, right, bottom, left }
        }
        const visible = [...toolbar.querySelectorAll('button:not([hidden])')].map((button) => ({
          id: button.id,
          label: button.getAttribute('aria-label') || button.textContent.trim(),
          rect: toRect(button),
          parent: button.parentElement?.className,
        }))
        const save = action('#save-document')
        const remove = action('#delete-document')
        const before = { topbar: toRect(topbar), editor: toRect(editor) }
        status.textContent = 'Editor failed to load — long-status-long-status-long-status-long-status'
        const after = { topbar: toRect(topbar), editor: toRect(editor) }
        const saveStyle = getComputedStyle(save)
        const removeStyle = getComputedStyle(remove)
        return {
          toolbar: toRect(toolbar),
          visible,
          rows: [...new Set(visible.map(({ rect }) => Math.round(rect.top)))],
          bodyFits: document.body.scrollWidth <= document.body.clientWidth,
          toolbarFits: toolbar.scrollWidth <= toolbar.clientWidth,
          statusText: status.textContent,
          statusEllipsizes: status.scrollWidth > status.clientWidth,
          before,
          after,
          save: {
            backgroundColor: saveStyle.backgroundColor,
            borderColor: saveStyle.borderColor,
            color: saveStyle.color,
            fontWeight: saveStyle.fontWeight,
          },
          remove: {
            backgroundColor: removeStyle.backgroundColor,
            borderColor: removeStyle.borderColor,
            color: removeStyle.color,
            fontWeight: removeStyle.fontWeight,
          },
          svg: [...document.querySelectorAll('#editor-actions svg, .library-card-edit svg')].map((icon) => ({
            width: icon.getAttribute('width'),
            height: icon.getAttribute('height'),
            viewBox: icon.getAttribute('viewBox'),
            fill: icon.getAttribute('fill'),
            stroke: icon.getAttribute('stroke'),
            strokeWidth: icon.getAttribute('stroke-width'),
            linecap: icon.getAttribute('stroke-linecap'),
            linejoin: icon.getAttribute('stroke-linejoin'),
            hidden: icon.getAttribute('aria-hidden'),
          })),
        }
      })
      assert.deepEqual(layout.visible.map(({ label }) => label), ['Copy MD', 'Copy compact', 'Save changes', 'Cancel', 'Delete'])
      assert.deepEqual(layout.visible.map(({ parent }) => parent), ['copy-actions', 'copy-actions', 'document-actions', 'document-actions', 'document-actions'])
      assert.equal(layout.rows.length, width === 375 ? 2 : 1)
      assert.equal(layout.bodyFits, true)
      assert.equal(layout.toolbarFits, true)
      assert.match(layout.statusText, /Editor failed to load/)
      assert.equal(layout.statusEllipsizes, width === 375)
      assert.deepEqual(layout.before, layout.after)
      for (const action of layout.visible) {
        assert.ok(action.rect.height >= 36)
        assert.ok(action.rect.left >= layout.toolbar.left)
        assert.ok(action.rect.right <= layout.toolbar.right)
        assert.ok(action.rect.top >= layout.toolbar.top)
        assert.ok(action.rect.bottom <= layout.toolbar.bottom)
      }
      for (const [index, action] of layout.visible.entries()) {
        for (const other of layout.visible.slice(index + 1)) {
          const overlaps = action.rect.left < other.rect.right && action.rect.right > other.rect.left && action.rect.top < other.rect.bottom && action.rect.bottom > other.rect.top
          assert.equal(overlaps, false, `${action.id} overlaps ${other.id}`)
        }
      }
      assert.notEqual(layout.save.backgroundColor, layout.remove.backgroundColor)
      assert.equal(layout.save.fontWeight, '700')
      assert.notEqual(layout.save.borderColor, layout.remove.borderColor)
      assert.notEqual(layout.save.color, layout.remove.color)
      assert.equal(layout.remove.fontWeight, '400')
      for (const icon of layout.svg) {
        assert.deepEqual(icon, {
          width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: '1.75', linecap: 'round', linejoin: 'round', hidden: 'true',
        })
      }

      const save = state.page.locator('#save-document')
      await save.hover()
      assert.notEqual(await save.evaluate((node) => getComputedStyle(node).backgroundColor), layout.save.backgroundColor)
      const saveBounds = await save.boundingBox()
      assert.ok(saveBounds)
      await state.page.mouse.move(saveBounds.x + saveBounds.width / 2, saveBounds.y + saveBounds.height / 2)
      await state.page.mouse.down()
      assert.notEqual(await save.evaluate((node) => getComputedStyle(node).transform), 'none')
      await state.page.mouse.move(0, 0)
      await state.page.mouse.up()
      await state.page.locator('#copy-compact').focus()
      await state.page.keyboard.press('Tab')
      assert.equal(await save.evaluate((node) => document.activeElement === node), true)
      assert.equal(await save.evaluate((node) => getComputedStyle(node).outlineStyle), 'solid')
      await save.evaluate((node) => { node.disabled = true })
      assert.equal(await save.evaluate((node) => getComputedStyle(node).cursor), 'not-allowed')
      assert.equal(await save.evaluate((node) => getComputedStyle(node).opacity), '0.55')
      await save.evaluate((node) => { node.disabled = false })
    }
  })

  test('moves manual ARIA tab focus without activation and leaves the tablist with Tab keys', async () => {
    await state.page.evaluate(
      ({ sessionKey, localKey }) => Promise.all([
        chrome.storage.session.remove(sessionKey),
        chrome.storage.local.remove(localKey),
      ]),
      { sessionKey: sessionDraftKey, localKey: libraryKey },
    )
    await state.page.reload()
    await state.page.locator('.ProseMirror').waitFor()

    const tabState = () => state.page.evaluate(() => ({
      activeId: document.activeElement?.id,
      editorSelected: document.querySelector('#tab-editor')?.getAttribute('aria-selected'),
      librarySelected: document.querySelector('#tab-library')?.getAttribute('aria-selected'),
      editorHidden: document.querySelector('#editor-view')?.hidden,
      libraryHidden: document.querySelector('#library-view')?.hidden,
      inTablist: document.activeElement?.closest('[role="tablist"]') !== null,
    }))

    await state.page.locator('#tab-editor').focus()
    await state.page.keyboard.press('ArrowLeft')
    assert.deepEqual(await tabState(), {
      activeId: 'tab-library',
      editorSelected: 'true',
      librarySelected: 'false',
      editorHidden: false,
      libraryHidden: true,
      inTablist: true,
    })

    await state.page.keyboard.press('ArrowLeft')
    assert.equal((await tabState()).activeId, 'tab-editor')
    await state.page.keyboard.press('ArrowRight')
    assert.equal((await tabState()).activeId, 'tab-library')
    await state.page.keyboard.press('ArrowRight')
    assert.equal((await tabState()).activeId, 'tab-editor')

    await state.page.locator('#tab-library').focus()
    await state.page.keyboard.press('Home')
    assert.equal((await tabState()).activeId, 'tab-editor')
    await state.page.keyboard.press('End')
    assert.equal((await tabState()).activeId, 'tab-library')

    await state.page.keyboard.press('Enter')
    assert.deepEqual(await tabState(), {
      activeId: 'tab-library',
      editorSelected: 'false',
      librarySelected: 'true',
      editorHidden: true,
      libraryHidden: false,
      inTablist: true,
    })

    await state.page.locator('#tab-editor').focus()
    await state.page.keyboard.press(' ')
    assert.deepEqual(await tabState(), {
      activeId: 'tab-editor',
      editorSelected: 'true',
      librarySelected: 'false',
      editorHidden: false,
      libraryHidden: true,
      inTablist: true,
    })

    await state.page.keyboard.press('Tab')
    assert.equal((await tabState()).inTablist, false)
    await state.page.locator('#tab-editor').focus()
    await state.page.keyboard.press('Shift+Tab')
    assert.equal((await tabState()).inTablist, false)
  })

  test('preserves a ProseMirror DOM selection when dirty navigation is dismissed', async () => {
    const savedDocument = {
      id: '44444444-4444-4444-8444-444444444444',
      markdown: '# Selection source\nAlpha bravo charlie delta\nSecond line',
      createdAt: 1,
      updatedAt: 1,
    }
    await state.page.evaluate(
      ({ sessionKey, localKey, document }) => Promise.all([
        chrome.storage.session.remove(sessionKey),
        chrome.storage.local.set({ [localKey]: [document] }),
      ]),
      { sessionKey: sessionDraftKey, localKey: libraryKey, document: savedDocument },
    )
    await state.page.reload()
    await state.page.locator('.ProseMirror').waitFor()
    await state.page.locator('#tab-library').click()
    await state.page.locator('.library-card-edit').click()
    await state.page.locator('.ProseMirror').press('End')
    await state.page.locator('.ProseMirror').pressSequentially(' updated')
    await state.page.waitForFunction(() => document.querySelector('#editor-mode')?.textContent?.includes('Unsaved changes'))

    const selectionTuple = () => state.page.evaluate(() => {
      const selection = window.getSelection()
      const paragraph = [...document.querySelectorAll('.ProseMirror p')]
        .find((element) => element.textContent?.includes('Alpha bravo charlie delta'))
      const text = paragraph?.firstChild
      if (!(text instanceof Text) || !selection) throw new Error('Selection fixture text is unavailable.')
      const range = document.createRange()
      range.setStart(text, 6)
      range.setEnd(text, 19)
      selection.removeAllRanges()
      selection.addRange(range)
      return {
        anchorText: selection.anchorNode?.textContent,
        anchorOffset: selection.anchorOffset,
        focusText: selection.focusNode?.textContent,
        focusOffset: selection.focusOffset,
        selectedText: selection.toString(),
      }
    })
    const selectionSnapshot = await selectionTuple()
    assert.deepEqual(selectionSnapshot, {
      anchorText: 'Alpha bravo charlie delta',
      anchorOffset: 6,
      focusText: 'Alpha bravo charlie delta',
      focusOffset: 19,
      selectedText: 'bravo charlie',
    })

    const dismissedMessage = await clickAndHandleDialog(
      state.page,
      state.page.locator('#tab-library'),
      'dismiss',
    )
    assert.match(dismissedMessage, /discard/i)
    assert.deepEqual(await state.page.evaluate(() => {
      const selection = window.getSelection()
      return {
        anchorText: selection?.anchorNode?.textContent,
        anchorOffset: selection?.anchorOffset,
        focusText: selection?.focusNode?.textContent,
        focusOffset: selection?.focusOffset,
        selectedText: selection?.toString(),
      }
    }), selectionSnapshot)
    assert.equal(await state.page.locator('#tab-editor').getAttribute('aria-selected'), 'true')
    assert.equal(await state.page.locator('#editor-view').isHidden(), false)
    assert.match(await state.page.locator('#editor-mode').textContent(), /Unsaved changes/)
    assert.equal(await state.page.locator('#tab-editor').evaluate((tab) => document.activeElement === tab), true)
  })

  test('covers status replacement, saved context, and a non-content placeholder', async (t) => {
    const page = state.page
    await page.clock.install({ time: new Date('2026-08-27T00:00:00Z') })
    t.after(async () => {
      await page.clock.resume()
    })
    const prepareStatusWait = (expected) =>
      page.evaluate((expectedStatus) => {
        const status = document.querySelector('#status')
        if (!(status instanceof HTMLElement)) {
          throw new Error('Status region is unavailable.')
        }
        window.__sidemarkdownStatusWait = new Promise((resolve) => {
          const complete = () => {
            if (status.textContent !== expectedStatus) return
            observer.disconnect()
            resolve()
          }
          const observer = new MutationObserver(complete)
          observer.observe(status, { childList: true, characterData: true, subtree: true })
          complete()
        })
      }, expected)
    const finishStatusWait = () =>
      page.evaluate(async () => {
        await window.__sidemarkdownStatusWait
        delete window.__sidemarkdownStatusWait
      })
    const clickAndWaitForStatus = async (selector, expected) => {
      await prepareStatusWait(expected)
      await page.locator(selector).click()
      await finishStatusWait()
      assert.equal(await page.locator('#status').textContent(), expected)
    }
    await page.evaluate(
      ({ sessionKey, localKey }) => Promise.all([
        chrome.storage.session.remove(sessionKey),
        chrome.storage.local.remove(localKey),
      ]),
      { sessionKey: sessionDraftKey, localKey: libraryKey },
    )
    await page.reload()
    await page.locator('.ProseMirror').waitFor()
    await page.clock.pauseAt(await page.evaluate(() => Date.now()))

    const initial = await page.evaluate(() => ({
      status: document.querySelector('#status').outerHTML,
      actionMode: document.querySelector('#editor-actions').dataset.mode,
      tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => ({
        id: tab.id,
        selected: tab.getAttribute('aria-selected'),
        tabIndex: tab.getAttribute('tabindex'),
      })),
      placeholder: document.querySelector('.ProseMirror').getAttribute('data-placeholder'),
      editorText: document.querySelector('.ProseMirror').textContent,
    }))
    assert.match(initial.status, /aria-atomic="true"/)
    assert.equal(initial.actionMode, 'draft')
    assert.deepEqual(initial.tabs, [
      { id: 'tab-editor', selected: 'true', tabIndex: '0' },
      { id: 'tab-library', selected: 'false', tabIndex: '-1' },
    ])
    assert.equal(initial.placeholder, 'Start writing…')
    assert.equal(initial.editorText, '')

    await clickAndWaitForStatus('#copy', 'Copied')
    await page.clock.fastForward(2_499)
    assert.equal(await page.locator('#status').textContent(), 'Copied')
    await page.clock.fastForward(1)
    assert.equal(await page.locator('#status').textContent(), '')

    await page.evaluate(() => {
      window.__sidemarkdownClipboardWriteText = navigator.clipboard.writeText
      window.__sidemarkdownExecCommand = document.execCommand
      navigator.clipboard.writeText = async () => { throw new Error('forced clipboard failure') }
      document.execCommand = () => { throw new Error('forced fallback failure') }
    })
    await clickAndWaitForStatus('#copy', 'Copy failed')
    for (const milliseconds of [2_499, 1, 2_499]) {
      await page.clock.fastForward(milliseconds)
      assert.equal(await page.locator('#status').textContent(), 'Copy failed')
    }
    await page.clock.fastForward(1)
    assert.equal(await page.locator('#status').textContent(), '')

    await page.evaluate(() => {
      navigator.clipboard.writeText = window.__sidemarkdownClipboardWriteText
      document.execCommand = window.__sidemarkdownExecCommand
      delete window.__sidemarkdownClipboardWriteText
      delete window.__sidemarkdownExecCommand
    })
    await clickAndWaitForStatus('#clear', 'Draft cleared')
    await page.clock.fastForward(1_000)
    assert.equal(await page.locator('#status').textContent(), 'Draft cleared')
    await clickAndWaitForStatus('#copy', 'Copied')
    await page.clock.fastForward(999)
    assert.equal(await page.locator('#status').textContent(), 'Copied')
    await page.clock.fastForward(1)
    assert.equal(await page.locator('#status').textContent(), 'Copied')
    await page.clock.fastForward(1_499)
    assert.equal(await page.locator('#status').textContent(), 'Copied')
    await page.clock.fastForward(1)
    assert.equal(await page.locator('#status').textContent(), '')

    await clickAndWaitForStatus('#save-draft', 'Saved to Library')
    await page.clock.fastForward(2_499)
    assert.equal(await page.locator('#status').textContent(), 'Saved to Library')
    await page.clock.fastForward(1)
    assert.equal(await page.locator('#status').textContent(), '')
  })

  test('renders stable absolute Library metadata and preserves explicit card actions under content stress', async () => {
    // Given
    const updatedAt = Date.UTC(2026, 7, 25, 12)
    const titled = {
      id: '22222222-2222-4222-8222-222222222222',
      markdown: '# Exact heading\nBody that must remain in the copied Markdown.',
      createdAt: updatedAt,
      updatedAt,
    }
    const untitled = {
      id: '33333333-3333-4333-8333-333333333333',
      markdown: '제목 없이도 긴 미리보기와 https://example.test/' + 'unbroken/'.repeat(80),
      createdAt: updatedAt - 1,
      updatedAt: updatedAt - 1,
    }
    await state.page.clock.install({ time: new Date('2026-08-27T00:00:00Z') })
    await state.page.evaluate(
      ({ sessionKey, localKey, documents }) => Promise.all([
        chrome.storage.session.set({ [sessionKey]: '# Preserved session draft' }),
        chrome.storage.local.set({ [localKey]: documents }),
      ]),
      { sessionKey: sessionDraftKey, localKey: libraryKey, documents: [titled, untitled] },
    )
    await state.page.reload()
    await state.page.locator('.ProseMirror').waitFor()
    await state.page.locator('#tab-library').click()
    const titledCard = state.page.locator(`[data-document-id="${titled.id}"]`)
    const untitledCard = state.page.locator(`[data-document-id="${untitled.id}"]`)

    // When / Then: semantic absolute metadata and no fabricated untitled heading.
    const metadata = titledCard.locator('time')
    assert.equal(await metadata.textContent(), 'Updated Aug 25, 2026')
    assert.equal(await metadata.getAttribute('datetime'), '2026-08-25T12:00:00.000Z')
    assert.equal(await metadata.getAttribute('aria-label'), 'Updated Aug 25, 2026')
    await state.page.clock.fastForward(86_400_000)
    assert.equal(await metadata.textContent(), 'Updated Aug 25, 2026')
    assert.equal(await untitledCard.locator('.library-card-title').count(), 0)

    // Copy retains durable storage/order; Edit must not become a hidden copy operation.
    const beforeCopy = await getLibrary(state.page)
    await titledCard.locator('.library-card-copy').click()
    assert.equal(
      (await state.page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n?/g, '\n'),
      titled.markdown,
    )
    assert.deepEqual(await getLibrary(state.page), beforeCopy)
    await state.page.evaluate(() => navigator.clipboard.writeText('__edit_sentinel__'))
    await titledCard.locator('.library-card-edit').click()
    assert.equal(await state.page.evaluate(() => navigator.clipboard.readText()), '__edit_sentinel__')
    await state.page.locator('#cancel-document').click()

    // Controls remain visible, focusable, non-overlapping, and wide enough across the responsive matrix.
    for (const colorScheme of ['light', 'dark']) {
      await state.page.emulateMedia({ colorScheme })
      for (const width of [375, 768, 1280]) {
        await state.page.setViewportSize({ width, height: 900 })
        const geometry = await state.page.evaluate(() => {
          const toRect = (element) => {
            const { left, right, top, bottom, width, height } = element.getBoundingClientRect()
            return { left, right, top, bottom, width, height }
          }
          const actions = [...document.querySelectorAll('.library-card-copy, .library-card-edit')]
          .map((element) => ({
              label: element.getAttribute('aria-label'),
              rect: toRect(element),
              visible: getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none',
              disabled: element.disabled,
              text: element.textContent?.trim(),
            }))
          return {
            bodyFits: document.body.scrollWidth <= document.body.clientWidth,
            cardsFit: [...document.querySelectorAll('.library-card')].every((card) => card.scrollWidth <= card.clientWidth),
            actions,
            spacing: {
              card: (() => {
                const style = getComputedStyle(document.querySelector('.library-card'))
                return { gap: style.gap, padding: style.padding }
              })(),
              copy: (() => {
                const style = getComputedStyle(document.querySelector('.library-card-copy'))
                return { columnGap: style.columnGap, rowGap: style.rowGap }
              })(),
              action: (() => {
                const style = getComputedStyle(document.querySelector('.library-card-copy-action'))
                return { gap: style.gap, padding: style.padding }
              })(),
            },
          }
        })
        assert.equal(geometry.bodyFits, true)
        assert.equal(geometry.cardsFit, true)
        assert.deepEqual(geometry.spacing, {
          card: { gap: '8px', padding: '16px' },
          copy: { columnGap: '12px', rowGap: '4px' },
          action: { gap: '4px', padding: '4px 8px' },
        })
        assert.equal(geometry.actions.length, 4)
        for (const action of geometry.actions) {
          assert.equal(action.visible, true)
          assert.equal(action.disabled, false)
          assert.ok(action.rect.height >= 36, `${action.label} must be at least 36px tall`)
          assert.ok(action.rect.width >= 36, `${action.label} must be at least 36px wide`)
        }
        assert.ok(
          geometry.actions.filter(({ text }) => text?.includes('Copy')).length >= 2,
          'each card must expose a persistent visible Copy label',
        )
        for (const [index, action] of geometry.actions.entries()) {
          for (const other of geometry.actions.slice(index + 1)) {
            const overlaps = action.rect.left < other.rect.right && action.rect.right > other.rect.left && action.rect.top < other.rect.bottom && action.rect.bottom > other.rect.top
            assert.equal(overlaps, false, `${action.label} overlaps ${other.label}`)
          }
        }
      }
    }

    // Empty recovery must reuse tab activation, keep the session draft, and focus the writer.
    await state.page.evaluate((key) => chrome.storage.local.remove(key), libraryKey)
    await state.page.reload()
    await state.page.locator('.ProseMirror').waitFor()
    await state.page.locator('#tab-library').click()
    assert.equal(
      await state.page.locator('#library-empty > p').textContent(),
      'Save a draft to build your local Library.',
    )
    await state.page.getByRole('button', { name: 'Go to Editor' }).click()
    assert.equal(await state.page.locator('#tab-editor').getAttribute('aria-selected'), 'true')
    assert.equal(await state.page.locator('#tab-editor').getAttribute('tabindex'), '0')
    assert.equal(await state.page.locator('#tab-library').getAttribute('tabindex'), '-1')
    assert.equal(await state.page.locator('.ProseMirror').evaluate((node) => document.activeElement === node), true)
    assert.equal((await getLibrary(state.page)).length, 0)
    assert.equal(
      (await state.page.evaluate((key) => chrome.storage.session.get(key), sessionDraftKey))[sessionDraftKey],
      '# Preserved session draft',
    )
    await state.page.clock.resume()
  })

  test('formats a late-UTC Library update on its UTC calendar day', async () => {
    // Given: this instant is Aug 26 in the host's Asia/Seoul timezone.
    const updatedAt = Date.UTC(2026, 7, 25, 20)
    const boundaryDocument = {
      id: '66666666-6666-4666-8666-666666666666',
      markdown: '# UTC boundary\nThe calendar date must remain deterministic.',
      createdAt: updatedAt,
      updatedAt,
    }
    await state.page.evaluate(
      ({ key, document }) => chrome.storage.local.set({ [key]: [document] }),
      { key: libraryKey, document: boundaryDocument },
    )
    await state.page.reload()
    await state.page.locator('.ProseMirror').waitFor()
    await state.page.locator('#tab-library').click()

    // When / Then
    const metadata = state.page.locator('.library-card time')
    assert.equal(
      await state.page.evaluate(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
      'UTC',
    )
    assert.equal(await metadata.textContent(), 'Updated Aug 25, 2026')
    assert.equal(await metadata.getAttribute('datetime'), '2026-08-25T20:00:00.000Z')
    assert.equal(await metadata.getAttribute('aria-label'), 'Updated Aug 25, 2026')
  })
})
