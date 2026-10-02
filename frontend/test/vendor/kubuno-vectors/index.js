// @kubuno/vectors: conformance-vector runner for Kubuno shared cores (SC-0).
//
// Loads a JSON vector suite (format 1, core repository `vectors/conformance-vectors.schema.json`), runs it
// against a function, compares with JSON semantics and reports every failing case at once. Verifies vendored
// suite folders against their VENDOR.json checksums. Node-only (tests), no dependencies; works with vitest or
// node:test. The Rust (`kubuno-vectors`) and Kotlin (`:core-vectors`) runners implement the same rules.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const FORMAT = 1
export const PLATFORM = 'ts'
export const PLATFORMS = ['rust', 'ts', 'kotlin', 'swift']
export const VENDOR_FILE = 'VENDOR.json'

const SUITE_KEYS = new Set(['$schema', 'format', 'suite', 'version', 'description', 'reference', 'cases'])
const CASE_KEYS = new Set(['id', 'input', 'expected', 'note', 'skip'])
const SUITE_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/
const CASE_ID = /^[a-z0-9][a-z0-9._/-]*$/
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

export class VectorError extends Error {
  constructor(message) {
    super(message)
    this.name = 'VectorError'
  }
}

/** Checks the rules of the JSON Schema plus unique case ids; returns the suite. */
export function validateSuite(suite) {
  const name = suite && typeof suite.suite === 'string' ? suite.suite : '<unnamed>'
  const fail = (m) => { throw new VectorError(`suite ${name}: ${m}`) }
  if (!suite || typeof suite !== 'object' || Array.isArray(suite)) fail('not an object')
  for (const k of Object.keys(suite)) if (!SUITE_KEYS.has(k)) fail(`unknown field ${JSON.stringify(k)}`)
  if (suite.format !== FORMAT) fail(`format ${suite.format} is not supported (this runner reads format ${FORMAT})`)
  if (typeof suite.suite !== 'string' || !SUITE_ID.test(suite.suite)) fail('the suite id must look like <domain>.<area>')
  if (typeof suite.version !== 'string' || !SEMVER.test(suite.version)) fail(`version ${JSON.stringify(suite.version)} is not X.Y.Z`)
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) fail('no cases')
  const seen = new Set()
  for (const c of suite.cases) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) fail('a case is not an object')
    for (const k of Object.keys(c)) if (!CASE_KEYS.has(k)) fail(`case ${c.id}: unknown field ${JSON.stringify(k)}`)
    if (typeof c.id !== 'string' || !CASE_ID.test(c.id)) fail(`case id ${JSON.stringify(c.id)} is not allowed`)
    if (seen.has(c.id)) fail(`duplicate case id ${JSON.stringify(c.id)}`)
    seen.add(c.id)
    if (!('input' in c) || !('expected' in c)) fail(`case ${c.id}: input and expected are required`)
    if (c.skip !== undefined) {
      if (!c.skip || typeof c.skip !== 'object' || Array.isArray(c.skip)) fail(`case ${c.id}: skip must be an object`)
      for (const [platform, reason] of Object.entries(c.skip)) {
        if (!PLATFORMS.includes(platform)) fail(`case ${c.id}: unknown platform ${JSON.stringify(platform)} in skip`)
        if (typeof reason !== 'string' || reason === '') fail(`case ${c.id}: a skip needs a reason`)
      }
    }
  }
  return suite
}

/** Parses (if given text) and validates a suite. */
export function parseSuite(textOrObject) {
  const suite = typeof textOrObject === 'string' ? JSON.parse(textOrObject) : textOrObject
  return validateSuite(suite)
}

/** Loads and validates a suite file. */
export function loadSuite(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    throw new VectorError(`${path}: ${e.message}`)
  }
  try {
    return parseSuite(text)
  } catch (e) {
    throw new VectorError(`${path}: ${e.message}`)
  }
}

/** JSON equality of vectors: numbers by value, object key order irrelevant, arrays ordered. */
export function jsonEqual(a, b) {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') return a === b
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => jsonEqual(x, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined)
    const kb = Object.keys(b).filter((k) => b[k] !== undefined)
    if (ka.length !== kb.length) return false
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual(a[k], b[k]))
  }
  return false
}

/** Normalises an output to JSON (drops undefined fields, turns undefined into null) before comparing. */
function toJson(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}

/** Runs every case of `suite` through `fn`; returns { suite, version, passed, skipped, failures }. */
export function runSuite(suite, fn) {
  const outcome = { suite: suite.suite, version: suite.version, passed: 0, skipped: [], failures: [] }
  for (const c of suite.cases) {
    const reason = c.skip && c.skip[PLATFORM]
    if (reason) { outcome.skipped.push({ id: c.id, reason }); continue }
    let actual
    try {
      actual = toJson(fn(structuredClone(c.input), c))
    } catch (e) {
      actual = { thrown: String(e && e.message ? e.message : e) }
    }
    if (jsonEqual(c.expected, actual)) outcome.passed++
    else outcome.failures.push({ id: c.id, expected: c.expected, actual, note: c.note })
  }
  return outcome
}

/** Human-readable report listing every failure. */
export function formatReport(outcome) {
  const lines = [`suite ${outcome.suite} ${outcome.version}: ${outcome.passed} passed, ${outcome.failures.length} failed, ${outcome.skipped.length} skipped`]
  for (const f of outcome.failures) {
    lines.push(`  FAIL ${f.id}`, `    expected: ${JSON.stringify(f.expected)}`, `    actual:   ${JSON.stringify(f.actual)}`)
    if (f.note) lines.push(`    note:     ${f.note}`)
  }
  for (const s of outcome.skipped) lines.push(`  skip ${s.id}: ${s.reason}`)
  return lines.join('\n')
}

/** Loads `pathOrSuite`, runs it and throws the full report when a case failed. Returns the outcome. */
export function assertSuite(pathOrSuite, fn) {
  const suite = typeof pathOrSuite === 'string' ? loadSuite(pathOrSuite) : validateSuite(pathOrSuite)
  const outcome = runSuite(suite, fn)
  if (outcome.failures.length) throw new VectorError(formatReport(outcome))
  return outcome
}

/**
 * Registers one test per case with a test framework (`{ describe, it }` of vitest or node:test), so that each case
 * shows up by id. Skipped cases use `it.skip` when the framework has it.
 */
export function defineVectorTests(pathOrSuite, fn, { describe, it }) {
  const suite = typeof pathOrSuite === 'string' ? loadSuite(pathOrSuite) : validateSuite(pathOrSuite)
  describe(`${suite.suite} ${suite.version}`, () => {
    for (const c of suite.cases) {
      const reason = c.skip && c.skip[PLATFORM]
      if (reason) {
        if (typeof it.skip === 'function') it.skip(`${c.id} (${reason})`, () => {})
        continue
      }
      it(c.id, () => {
        const outcome = runSuite({ ...suite, cases: [c] }, fn)
        if (outcome.failures.length) throw new VectorError(formatReport(outcome))
      })
    }
  })
  return suite
}

/** `sha256:<hex>` of a vector file, after replacing every CRLF with LF. */
export function checksum(bytes) {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes)
  const out = []
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue
    out.push(buf[i])
  }
  return 'sha256:' + createHash('sha256').update(Buffer.from(out)).digest('hex')
}

/** Checks `dir/VENDOR.json` against the files of `dir`; returns the manifest or throws. */
export function verifyVendor(dir) {
  const fail = (m) => { throw new VectorError(`${dir}: vendored vectors do not match ${VENDOR_FILE}: ${m} (re-vendor them)`) }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(dir, VENDOR_FILE), 'utf8'))
  } catch (e) {
    fail(`${VENDOR_FILE}: ${e.message}`)
  }
  if (manifest.format !== FORMAT) fail(`format ${manifest.format} is not supported`)
  for (const k of ['source', 'ref', 'path']) if (typeof manifest[k] !== 'string' || !manifest[k]) fail(`${k} is missing`)
  const files = manifest.files || {}
  if (!Object.keys(files).length) fail('no files listed')
  for (const [name, expected] of Object.entries(files)) {
    let bytes
    try { bytes = readFileSync(join(dir, name)) } catch (e) { fail(`${name}: ${e.message}`) }
    const actual = checksum(bytes)
    if (actual !== expected) fail(`${name}: checksum ${actual}, ${VENDOR_FILE} says ${expected}`)
  }
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.json') && name !== VENDOR_FILE && !(name in files)) fail(`${name} is not listed`)
  }
  return manifest
}
