import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  createErrorBuckets,
  evaluateQuality,
  parseFixture,
  runBatch,
  validateFixture,
} from './helpers/extension-quality.mjs'

const root = path.resolve(import.meta.dirname, '..')
const fixturePath = path.join(root, 'tests', 'fixtures', 'extension-quality-baseline.json')
const fixtureValue = () => JSON.parse(readFileSync(fixturePath, 'utf8'))

const sample = (number, overrides = {}) => ({
  sample: number,
  readyMs: 200 + number,
  copyFeedbackMs: 20,
  tabFeedbackMs: 10,
  errors: createErrorBuckets(),
  ...overrides,
})

test('quality fixture accepts the immutable Todo 1 and same-session provenance', () => {
  // Given
  const fixture = fixtureValue()

  // When
  const parsed = validateFixture(fixture)

  // Then
  assert.equal(parsed.boundary.version, 'todo1-ready-v1')
  assert.equal(parsed.provenance.todo1BaseSha, '0b7a49d5760a6785566f22729f71ca648253860b')
  assert.equal(parsed.provenance.sameSessionReference.median, 235.383)
  assert.equal(parsed.browser.protocol, 'chrome-extension')
  assert.equal(parsed.todo1Assets.length, 3)
})

test('quality fixture rejects malformed timing provenance at the parse boundary', () => {
  // Given
  const malformed = fixtureValue()
  malformed.provenance.sameSessionReference.median = 235

  // When / Then
  assert.throws(() => validateFixture(malformed), /same-session median/)
  assert.throws(() => parseFixture(path.join(root, 'tests', 'fixtures', 'missing.json')))
})

test('quality evaluator passes a complete bounded local batch', () => {
  // Given
  const fixture = parseFixture(fixturePath)
  const assetReceipts = fixture.todo1Assets.map((asset) => ({
    ...asset,
    budgetBytes: fixture.budgets[asset.path.endsWith('.js') ? 'sidepanelJsGzip' : asset.path.endsWith('.css') ? 'sidepanelCssGzip' : 'sidepanelHtmlGzip'],
  }))

  // When
  const result = evaluateQuality({ fixture, samples: [sample(1), sample(2), sample(3)], assetReceipts })

  // Then
  assert.equal(result.pass, true)
  assert.equal(result.source.todo1BaseSha, fixture.provenance.todo1BaseSha)
  assert.equal(result.boundary.version, fixture.boundary.version)
  assert.equal(result.assets.pass, true)
})

test('quality evaluator rejects external traffic, runtime errors, oversized assets, and timing regressions', () => {
  // Given
  const fixture = parseFixture(fixturePath)
  const assetReceipts = fixture.todo1Assets.map((asset) => ({ ...asset, budgetBytes: 999_999 }))
  const cleanSamples = [sample(1), sample(2), sample(3)]

  // When / Then
  assert.equal(evaluateQuality({ fixture, samples: cleanSamples, assetReceipts, injected: { ...createErrorBuckets(), externalRequests: ['https://example.invalid/'] } }).pass, false)
  assert.equal(evaluateQuality({ fixture, samples: cleanSamples, assetReceipts, injected: { ...createErrorBuckets(), page: ['synthetic page error'] } }).pass, false)
  assert.equal(evaluateQuality({ fixture, samples: cleanSamples, assetReceipts: [{ ...assetReceipts[0], gzipBytes: assetReceipts[0].budgetBytes + 1 }, ...assetReceipts.slice(1)] }).pass, false)
  assert.equal(evaluateQuality({ fixture, samples: [sample(1, { readyMs: 300 }), sample(2, { readyMs: 301 }), sample(3, { readyMs: 302 })], assetReceipts }).pass, false)
})

test('quality documentation follows shipped actions without stale interaction or test-count claims', () => {
  // Given
  const html = readFileSync(path.join(root, 'sidepanel.html'), 'utf8')
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
  const packageManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const labels = [...html.matchAll(/<button\s+id="(copy|copy-compact|clear|save-draft|save-document)"[^>]*>([\s\S]*?)<\/button>/g)]
    .map(([, , content]) => content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())

  // When / Then
  for (const label of labels) assert.ok(readme.includes(`\`${label}\``), `README must derive ${label} from the shipped action`)
  assert.match(readme, /카드의 `Copy`/)
  assert.doesNotMatch(readme, /카드를 누르면|카드 클릭/)
  assert.doesNotMatch(readme, /\b(?:19|20)\b[^\n]*(?:test|flow)/i)
  assert.equal(readme.includes('.omo'), false)
  assert.equal(readme.includes('Lighthouse'), false)
  assert.equal(packageManifest.scripts['test:quality'], 'npm run build && node --test tests/extension-quality.test.mjs')
  assert.equal(packageManifest.scripts['test:all'].includes('test:quality'), false)
})

test('quality gate runs one fresh headed three-profile extension-origin batch', { timeout: 60_000 }, async () => {
  // Given
  const fixture = parseFixture(fixturePath)

  // When
  const report = await runBatch({ root, fixture, reportPath: process.env.EXTENSION_QUALITY_REPORT })

  // Then
  assert.equal(report.result.pass, true, JSON.stringify(report.result.diagnostics, null, 2))
  assert.equal(report.samples.length, 3)
  assert.equal(report.cleanup.every((entry) => entry.removed), true)
})
