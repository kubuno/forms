// Runs the conformance vectors of the shared forms core (crates/kubuno-forms-core/vectors) against the
// TypeScript logic of the public page. The Rust core runs the same files (crates/kubuno-forms-core/tests).
// Run: npx vitest run (CI: checks.yml, frontend job).
import { describe, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineVectorTests, verifyVendor } from './vendor/kubuno-vectors/index.js'
import {
  checkAnswer, compareIds, computeHidden, evalOperator, flowModeOf, reachedQuestions, resolveJump,
  validateSubmission, type LogicQuestion, type LogicRule,
} from '../src/logic'
import type { RuleOperator } from '../src/api'

const here = dirname(fileURLToPath(import.meta.url))
const vectors = (name: string) => join(here, '../../crates/kubuno-forms-core/vectors', name)

// The runner is vendored (no npm dependency): refuse a copy that drifted from its pinned version.
describe('vendored @kubuno/vectors', () => {
  it('matches VENDOR.json', () => { verifyVendor(join(here, 'vendor/kubuno-vectors')) })
})

type In = {
  questions?: LogicQuestion[]
  rules?: LogicRule[]
  answers?: Record<string, unknown>
  settings?: { displayMode?: unknown }
}
const tests = { describe, it }

defineVectorTests(vectors('operators.json'), (i: { operator: RuleOperator; answer?: unknown; compare?: unknown }) =>
  evalOperator(i.operator, i.answer, i.compare ?? null), tests)

defineVectorTests(vectors('hidden.json'), (i: In) =>
  [...computeHidden(i.questions ?? [], i.rules ?? [], i.answers ?? {})].sort(compareIds), tests)

defineVectorTests(vectors('jump.json'), (i: In & { question_id: string }) => {
  const j = resolveJump(i.question_id, i.rules ?? [], i.answers ?? {})
  return j?.kind === 'goto' ? { kind: 'goto', target_id: j.targetId } : j
}, tests)

defineVectorTests(vectors('reached.json'), (i: In) =>
  reachedQuestions(i.questions ?? [], i.rules ?? [], i.answers ?? {}, flowModeOf(i.settings)).map(q => q.id), tests)

defineVectorTests(vectors('answer.json'), (i: { question: LogicQuestion; value?: unknown }) =>
  checkAnswer(i.question, i.value), tests)

defineVectorTests(vectors('submission.json'), (i: Omit<In, 'answers'> & { answers?: { question_id: string; value: unknown }[] }) =>
  validateSubmission(i.questions ?? [], i.rules ?? [], flowModeOf(i.settings), i.answers ?? []), tests)
