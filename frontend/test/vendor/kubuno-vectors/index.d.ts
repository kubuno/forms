// Types of @kubuno/vectors (see index.js).

export declare const FORMAT: 1
export declare const PLATFORM: 'ts'
export declare const PLATFORMS: readonly ['rust', 'ts', 'kotlin', 'swift']
export declare const VENDOR_FILE: 'VENDOR.json'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export interface VectorCase {
  id: string
  input: Json
  expected: Json
  note?: string
  skip?: Partial<Record<'rust' | 'ts' | 'kotlin' | 'swift', string>>
}

export interface VectorSuite {
  $schema?: string
  format: 1
  suite: string
  version: string
  description?: string
  reference?: string
  cases: VectorCase[]
}

export interface VectorFailure {
  id: string
  expected: Json
  actual: Json
  note?: string
}

export interface VectorOutcome {
  suite: string
  version: string
  passed: number
  skipped: { id: string; reason: string }[]
  failures: VectorFailure[]
}

export interface VendorManifest {
  format: 1
  source: string
  ref: string
  path: string
  files: Record<string, string>
}

/** The function under test: receives a deep copy of the case input (`any`, as its shape is per suite). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VectorFn = (input: any, testCase: VectorCase) => unknown

export declare class VectorError extends Error {}

export declare function validateSuite(suite: unknown): VectorSuite
export declare function parseSuite(textOrObject: string | unknown): VectorSuite
export declare function loadSuite(path: string): VectorSuite
export declare function jsonEqual(a: unknown, b: unknown): boolean
export declare function runSuite(suite: VectorSuite, fn: VectorFn): VectorOutcome
export declare function formatReport(outcome: VectorOutcome): string
export declare function assertSuite(pathOrSuite: string | VectorSuite, fn: VectorFn): VectorOutcome
export declare function defineVectorTests(
  pathOrSuite: string | VectorSuite,
  fn: VectorFn,
  framework: {
    describe: (name: string, body: () => void) => unknown
    it: ((name: string, body: () => void) => unknown) & { skip?: (name: string, body: () => void) => unknown }
  },
): VectorSuite
export declare function checksum(bytes: Uint8Array | string): string
export declare function verifyVendor(dir: string): VendorManifest
