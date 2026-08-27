import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright'

export const boundaryVersion = 'todo1-ready-v1'
export const readyBoundary = 'Node performance.now() immediately before page.goto(extensionUrl) through visible .ProseMirror, enabled Editor/Library tabs and every visible action, resolved Editor view, then one requestAnimationFrame'

const expectedTodo1BaseSha = '0b7a49d5760a6785566f22729f71ca648253860b'
const expectedSameSessionMedian = 235.383
const expectedMultiplier = 1.1
const expectedAssetPaths = [
  'dist/assets/sidepanel.js',
  'dist/assets/sidepanel.css',
  'dist/sidepanel.html',
]

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const failFixture = (message) => { throw new Error(`invalid extension quality fixture: ${message}`) }
const finite = (value) => typeof value === 'number' && Number.isFinite(value)

export const createErrorBuckets = () => ({
  page: [],
  worker: [],
  requestFailed: [],
  externalRequests: [],
  console: [],
  harness: [],
})

export const median = (values) => {
  if (!Array.isArray(values) || values.length === 0 || values.length % 2 === 0 || values.some((value) => !finite(value))) {
    throw new Error('quality median requires a non-empty odd count of finite values')
  }
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]
}

const validateSamples = (value, name) => {
  if (!isRecord(value) || !Array.isArray(value.samples) || value.samples.length !== 3) failFixture(`${name} samples`)
  const computedMedian = median(value.samples)
  if (!finite(value.median) || value.median !== computedMedian) failFixture(`${name} median`)
  return value
}

const validateAsset = (asset, index) => {
  if (!isRecord(asset) || asset.path !== expectedAssetPaths[index]) failFixture(`Todo 1 asset ${index + 1} path`)
  if (!Number.isInteger(asset.rawBytes) || asset.rawBytes <= 0) failFixture(`Todo 1 asset ${asset.path} raw bytes`)
  if (!Number.isInteger(asset.gzipBytes) || asset.gzipBytes <= 0) failFixture(`Todo 1 asset ${asset.path} gzip bytes`)
  if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) failFixture(`Todo 1 asset ${asset.path} hash`)
}

export const validateFixture = (fixture) => {
  if (!isRecord(fixture) || fixture.schemaVersion !== 1) failFixture('schema version')
  if (!isRecord(fixture.boundary) || fixture.boundary.version !== boundaryVersion || fixture.boundary.description !== readyBoundary) failFixture('canonical readiness boundary')
  if (!isRecord(fixture.provenance) || fixture.provenance.todo1BaseSha !== expectedTodo1BaseSha) failFixture('Todo 1 base SHA')
  validateSamples(fixture.provenance.historicalTodo1, 'historical Todo 1')
  const sameSession = validateSamples(fixture.provenance.sameSessionReference, 'same-session')
  if (sameSession.median !== expectedSameSessionMedian) failFixture('same-session median')
  if (typeof sameSession.candidateSha !== 'string' || !/^[a-f0-9]{40}$/.test(sameSession.candidateSha)) failFixture('same-session candidate SHA')
  if (!isRecord(fixture.browser) || fixture.browser.engine !== 'chromium' || fixture.browser.package !== 'playwright@1.62.1' || fixture.browser.protocol !== 'chrome-extension' || fixture.browser.headed !== true) failFixture('browser protocol')
  if (!isRecord(fixture.browser.viewport) || fixture.browser.viewport.width !== 375 || fixture.browser.viewport.height !== 900) failFixture('browser viewport')
  if (fixture.multiplier !== expectedMultiplier) failFixture('regression multiplier')
  if (!isRecord(fixture.budgets) || fixture.budgets.readyMs !== 2000 || fixture.budgets.feedbackMs !== 250 || fixture.budgets.sidepanelJsGzip !== 140000 || fixture.budgets.sidepanelCssGzip !== 8192 || fixture.budgets.sidepanelHtmlGzip !== 12288) failFixture('absolute budgets')
  if (!Array.isArray(fixture.todo1Assets) || fixture.todo1Assets.length !== expectedAssetPaths.length) failFixture('Todo 1 assets')
  fixture.todo1Assets.forEach(validateAsset)
  return fixture
}

export const parseFixture = (file) => validateFixture(JSON.parse(readFileSync(file, 'utf8')))

const assetBudget = (fixture, relative) => {
  if (relative.endsWith('.js')) return fixture.budgets.sidepanelJsGzip
  if (relative.endsWith('.css')) return fixture.budgets.sidepanelCssGzip
  return fixture.budgets.sidepanelHtmlGzip
}

export const assets = (root, fixture) => expectedAssetPaths.map((relative) => {
  const file = path.join(root, ...relative.split('/'))
  const bytes = readFileSync(file)
  return {
    path: relative,
    rawBytes: statSync(file).size,
    gzipBytes: gzipSync(bytes).length,
    budgetBytes: assetBudget(fixture, relative),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
})

const valuesFromBuckets = (buckets) => Object.values(buckets).flat()
const issuesForSample = (fixture, entry) => {
  if (!isRecord(entry)) return ['sample is not an object']
  const issues = []
  if (!finite(entry.readyMs) || entry.readyMs > fixture.budgets.readyMs) issues.push(`sample ${entry.sample} readiness`)
  if (!finite(entry.copyFeedbackMs) || entry.copyFeedbackMs > fixture.budgets.feedbackMs) issues.push(`sample ${entry.sample} copy feedback`)
  if (!finite(entry.tabFeedbackMs) || entry.tabFeedbackMs > fixture.budgets.feedbackMs) issues.push(`sample ${entry.sample} tab feedback`)
  if (!isRecord(entry.errors)) issues.push(`sample ${entry.sample} error buckets`)
  return issues
}

export const evaluateQuality = ({ fixture, samples, assetReceipts, injected = createErrorBuckets() }) => {
  validateFixture(fixture)
  const sampleIssues = !Array.isArray(samples) || samples.length !== 3
    ? ['exactly three fresh samples are required']
    : samples.flatMap((entry) => issuesForSample(fixture, entry))
  const readyValues = Array.isArray(samples) && samples.length === 3 ? samples.map((entry) => entry.readyMs) : []
  const currentMedian = readyValues.length === 3 && readyValues.every(finite) ? median(readyValues) : null
  const limit = fixture.provenance.sameSessionReference.median * fixture.multiplier
  const receivedAssets = Array.isArray(assetReceipts) ? assetReceipts : []
  const assetDiagnostics = receivedAssets.map((asset) => ({
    path: asset?.path ?? 'unknown',
    gzipBytes: asset?.gzipBytes ?? null,
    budgetBytes: asset?.budgetBytes ?? null,
    pass: isRecord(asset) && Number.isInteger(asset.gzipBytes) && asset.gzipBytes <= asset.budgetBytes,
  }))
  const assetPass = receivedAssets.length === expectedAssetPaths.length
    && assetDiagnostics.every((asset, index) => asset.path === expectedAssetPaths[index] && asset.pass)
  const runtimeErrors = [
    ...(Array.isArray(samples) ? samples.flatMap((entry) => isRecord(entry?.errors) ? valuesFromBuckets(entry.errors) : []) : []),
    ...(isRecord(injected) ? valuesFromBuckets(injected) : ['invalid injected error buckets']),
  ]
  const timingPass = currentMedian !== null && currentMedian <= limit
  const diagnostics = {
    sampleIssues,
    timing: { currentMedian, referenceMedian: fixture.provenance.sameSessionReference.median, multiplier: fixture.multiplier, limit, pass: timingPass },
    runtimeErrors,
  }
  return {
    pass: sampleIssues.length === 0 && timingPass && assetPass && runtimeErrors.length === 0,
    source: {
      todo1BaseSha: fixture.provenance.todo1BaseSha,
      historicalSamples: fixture.provenance.historicalTodo1.samples,
      historicalMedian: fixture.provenance.historicalTodo1.median,
      sameSessionCandidateSha: fixture.provenance.sameSessionReference.candidateSha,
    },
    boundary: fixture.boundary,
    browser: fixture.browser,
    assets: { pass: assetPass, receipts: assetDiagnostics },
    diagnostics,
  }
}

const assertReady = async (page) => {
  await page.locator('.ProseMirror').waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForFunction(() => {
    const editor = document.querySelector('#tab-editor')
    const library = document.querySelector('#tab-library')
    const active = document.querySelector('[role="tabpanel"]:not([hidden])')
    const visibleActions = [...document.querySelectorAll('button')].filter((button) => button.checkVisibility())
    return editor?.getAttribute('aria-selected') === 'true'
      && active?.id === 'editor-view'
      && editor instanceof HTMLButtonElement
      && library instanceof HTMLButtonElement
      && !editor.disabled
      && !library.disabled
      && visibleActions.length > 0
      && visibleActions.every((button) => !button.disabled)
  }, undefined, { timeout: 10_000 })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

const runSample = async ({ root, fixture, number }) => {
  const dist = path.join(root, 'dist')
  const profile = mkdtempSync(path.join(os.tmpdir(), `sidemarkdown-quality-v1-${number}-`))
  const receipt = {
    sample: number,
    profileName: path.basename(profile),
    readyMs: null,
    copyFeedbackMs: null,
    tabFeedbackMs: null,
    errors: createErrorBuckets(),
    cleanup: { removed: false },
  }
  let context
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: !fixture.browser.headed,
      viewport: fixture.browser.viewport,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 10_000 })
    const workerUrl = new URL(worker.url())
    if (workerUrl.protocol !== `${fixture.browser.protocol}:`) throw new Error(`unexpected worker protocol: ${workerUrl.protocol}`)
    const origin = `${workerUrl.protocol}//${workerUrl.host}`
    receipt.origin = origin
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const page = await context.newPage()
    page.on('pageerror', (error) => receipt.errors.page.push(error.message))
    page.on('requestfailed', (request) => receipt.errors.requestFailed.push({ url: request.url(), failure: request.failure() }))
    page.on('request', (request) => {
      const url = request.url()
      if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) receipt.errors.externalRequests.push(url)
    })
    page.on('console', (message) => { if (message.type() === 'error') receipt.errors.console.push(`page: ${message.text()}`) })
    worker.on('console', (message) => { if (message.type() === 'error') receipt.errors.worker.push(message.text()) })
    const start = performance.now()
    await page.goto(`${origin}/sidepanel.html`, { waitUntil: 'load', timeout: 10_000 })
    await assertReady(page)
    receipt.readyMs = Number((performance.now() - start).toFixed(3))
    const copyStart = await page.evaluate(() => performance.now())
    await page.locator('#copy').click()
    await page.getByRole('status').filter({ hasText: 'Copied' }).waitFor({ timeout: 10_000 })
    receipt.copyFeedbackMs = Number(((await page.evaluate(() => performance.now())) - copyStart).toFixed(3))
    const tabStart = await page.evaluate(() => performance.now())
    await page.locator('#tab-library').click()
    await page.waitForFunction(() => document.querySelector('#library-view:not([hidden])') !== null, undefined, { timeout: 10_000 })
    receipt.tabFeedbackMs = Number(((await page.evaluate(() => performance.now())) - tabStart).toFixed(3))
  } catch (error) {
    receipt.errors.harness.push(error instanceof Error ? error.message : String(error))
  } finally {
    if (context) {
      try {
        await context.close()
      } catch (error) {
        receipt.errors.harness.push(error instanceof Error ? error.message : String(error))
      }
    }
    try {
      rmSync(profile, { recursive: true, force: true })
      receipt.cleanup.removed = !existsSync(profile)
    } catch (error) {
      receipt.errors.harness.push(error instanceof Error ? error.message : String(error))
    }
  }
  return receipt
}

export const runBatch = async ({ root, fixture, reportPath }) => {
  validateFixture(fixture)
  const assetReceipts = assets(root, fixture)
  const samples = []
  for (const number of [1, 2, 3]) samples.push(await runSample({ root, fixture, number }))
  const cleanup = samples.map(({ sample, profileName, cleanup }) => ({ sample, profileName, ...cleanup }))
  const result = evaluateQuality({ fixture, samples, assetReceipts })
  const report = { boundary: fixture.boundary, browser: fixture.browser, samples, cleanup, assets: assetReceipts, result }
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return report
}
