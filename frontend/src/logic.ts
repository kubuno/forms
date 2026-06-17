// Client-side evaluation of conditional rules: which questions are visible,
// and where to jump after answering a question. Mirrors the operators allowed
// by the backend CHECK constraints.
import type { ConditionalRule, RuleOperator } from './api'

type Answers = Record<string, unknown>

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v)
  return null
}

function toStr(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(',')
  return String(v)
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

/** Evaluate one operator against an answer value and the rule's compare value. */
export function evalOperator(op: RuleOperator, answer: unknown, compare: unknown): boolean {
  switch (op) {
    case 'is_empty':     return isEmpty(answer)
    case 'is_not_empty': return !isEmpty(answer)
    case 'equals':
      if (Array.isArray(answer)) return answer.map(String).includes(String(compare))
      return toStr(answer).toLowerCase() === toStr(compare).toLowerCase()
    case 'not_equals':
      return !evalOperator('equals', answer, compare)
    case 'contains':
      if (Array.isArray(answer)) return answer.map(String).includes(String(compare))
      return toStr(answer).toLowerCase().includes(toStr(compare).toLowerCase())
    case 'not_contains':
      return !evalOperator('contains', answer, compare)
    case 'starts_with':
      return toStr(answer).toLowerCase().startsWith(toStr(compare).toLowerCase())
    case 'ends_with':
      return toStr(answer).toLowerCase().endsWith(toStr(compare).toLowerCase())
    case 'greater_than': {
      const a = toNum(answer), b = toNum(compare); return a != null && b != null && a > b
    }
    case 'greater_or_equal': {
      const a = toNum(answer), b = toNum(compare); return a != null && b != null && a >= b
    }
    case 'less_than': {
      const a = toNum(answer), b = toNum(compare); return a != null && b != null && a < b
    }
    case 'less_or_equal': {
      const a = toNum(answer), b = toNum(compare); return a != null && b != null && a <= b
    }
    default:
      return false
  }
}

export function ruleMatches(rule: ConditionalRule, answers: Answers): boolean {
  return evalOperator(rule.operator, answers[rule.trigger_question_id], rule.compare_value)
}

/**
 * Returns the set of hidden question ids given the current answers.
 * - `show_section` targets default to hidden and appear only when a matching rule fires.
 * - `hide_section` targets are hidden when a matching rule fires.
 * A target that is a `section` hides the whole range up to (but excluding) the next section.
 */
export function computeHidden<T extends { id: string; question_type: string }>(
  questions: T[],
  rules: ConditionalRule[],
  answers: Answers,
): Set<string> {
  const indexById = new Map(questions.map((q, i) => [q.id, i]))

  // Expand a target id to the range of question ids it controls.
  const rangeOf = (targetId: string | null): string[] => {
    if (!targetId) return []
    const start = indexById.get(targetId)
    if (start == null) return []
    if (questions[start].question_type !== 'section') return [targetId]
    const ids: string[] = []
    for (let i = start; i < questions.length; i++) {
      if (i > start && questions[i].question_type === 'section') break
      ids.push(questions[i].id)
    }
    return ids
  }

  const hidden = new Set<string>()
  // Default-hide every show_section target.
  for (const r of rules) {
    if (r.action === 'show_section') rangeOf(r.target_section_id).forEach(id => hidden.add(id))
  }
  // Reveal matched show_section targets; hide matched hide_section targets.
  for (const r of rules) {
    if (!ruleMatches(r, answers)) continue
    if (r.action === 'show_section') rangeOf(r.target_section_id).forEach(id => hidden.delete(id))
    if (r.action === 'hide_section') rangeOf(r.target_section_id).forEach(id => hidden.add(id))
  }
  return hidden
}

export type JumpResult =
  | { kind: 'goto'; targetId: string }
  | { kind: 'thankyou' }
  | { kind: 'submit' }
  | null

/**
 * After answering `questionId`, resolve the first matching jump/branch rule.
 * Returns null when the flow should simply advance to the next question.
 */
export function resolveJump(
  questionId: string,
  rules: ConditionalRule[],
  answers: Answers,
): JumpResult {
  const applicable = rules
    .filter(r => r.trigger_question_id === questionId)
    .filter(r => ['go_to_section', 'skip_to_question', 'jump_to_thankyou', 'submit_form'].includes(r.action))
    .sort((a, b) => a.position - b.position)

  for (const r of applicable) {
    if (!ruleMatches(r, answers)) continue
    if (r.action === 'submit_form') return { kind: 'submit' }
    if (r.action === 'jump_to_thankyou') return { kind: 'thankyou' }
    if (r.target_section_id) return { kind: 'goto', targetId: r.target_section_id }
  }
  return null
}
