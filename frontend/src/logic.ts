// Client-side evaluation of conditional rules (which questions are visible,
// where to jump after answering a question, which questions the respondent
// reached) and validation of the answers (required questions, answer shapes).
//
// The server runs the same rules from the shared Rust core
// (crates/kubuno-forms-core); both implementations run the conformance vectors
// of crates/kubuno-forms-core/vectors (frontend/test/logic.vectors.test.ts), so
// the page and the server always agree on what may be submitted.
import type { ConditionalRule, RuleOperator } from './api'

type Answers = Record<string, unknown>

/** What the logic needs to know about a rule (a stored rule has more fields). */
export type LogicRule = Pick<ConditionalRule, 'trigger_question_id' | 'operator' | 'compare_value' | 'action' | 'target_section_id' | 'position'>

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

export function ruleMatches(rule: LogicRule, answers: Answers): boolean {
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
  rules: LogicRule[],
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
  rules: LogicRule[],
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

// ── Reached questions ─────────────────────────────────────────────────────────

/** What the logic needs to know about a question. */
export interface LogicQuestion {
  id:            string
  question_type: string
  required?:     boolean
  options?:      Record<string, unknown> | null
}

/** How the public page presents the form: one question per screen (jump rules apply) or the classic shell. */
export type FlowMode = 'one_at_a_time' | 'classic'

/** Reads `settings.displayMode` as the page does: absent or null means one at a time; any other value, classic. */
export function flowModeOf(settings: { displayMode?: unknown } | null | undefined): FlowMode {
  const m = settings?.displayMode
  return m == null || m === 'one_at_a_time' ? 'one_at_a_time' : 'classic'
}

/** Question types that collect no answer. */
export const CONTENT_TYPES: readonly string[] = ['image', 'video', 'statement', 'section', 'welcome_screen', 'thank_you_screen']

export function isContentQuestion(type: string): boolean {
  return CONTENT_TYPES.includes(type)
}

/**
 * The questions the respondent was shown, in order, given the final answers. Classic shell: every question
 * not hidden (welcome and thank-you screens excluded). One at a time: the path from the first step following
 * jump rules, as the page walks it, stopping on submit, after the last step or when it would revisit a step.
 */
export function reachedQuestions<T extends LogicQuestion>(
  questions: T[],
  rules: LogicRule[],
  answers: Answers,
  mode: FlowMode,
): T[] {
  const hidden = computeHidden(questions, rules, answers)
  if (mode === 'classic') {
    return questions.filter(q => !hidden.has(q.id) && q.question_type !== 'welcome_screen' && q.question_type !== 'thank_you_screen')
  }
  const steps = questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => !hidden.has(q.id) && !['section', 'welcome_screen', 'thank_you_screen'].includes(q.question_type))
  const path: T[] = []
  const seen = new Set<number>()
  let current: number | null = steps.length ? 0 : null
  while (current != null) {
    if (seen.has(current)) break
    seen.add(current)
    const { q } = steps[current]
    path.push(q)
    const jump = resolveJump(q.id, rules, answers)
    if (jump?.kind === 'submit' || jump?.kind === 'thankyou') break
    if (jump?.kind === 'goto') {
      // First step at or after the target (an unknown target is position -1: the first step).
      const targetPos = questions.findIndex(x => x.id === jump.targetId)
      const next = steps.findIndex(s => s.i >= targetPos)
      current = next >= 0 ? next : null
    } else {
      current = current + 1 < steps.length ? current + 1 : null
    }
  }
  return path
}

// ── Answer validation ─────────────────────────────────────────────────────────

/** Why an answer or a submission is refused (stable codes shared with the server). */
export type IssueCode =
  | 'required' | 'invalid_type' | 'invalid_choice' | 'out_of_range' | 'too_long' | 'invalid_format' | 'duplicate_answer'

export interface Issue { question_id: string; code: IssueCode }

export const MAX_SHORT_TEXT = 10_000
export const MAX_LONG_TEXT = 100_000
export const MAX_LINK = 2_048
export const MAX_SIGNATURE = 2_000_000
export const MAX_PHONE = 32
export const MAX_ATTRIBUTE = 200

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => v != null && typeof v === 'object' && !Array.isArray(v)
const chars = (s: string) => [...s].length
const nonBlankStr = (v: unknown) => typeof v === 'string' && v.trim() !== ''
const anyNonBlankField = (v: Obj) => Object.values(v).some(x => nonBlankStr(x) || typeof x === 'number')

/** True when the value counts as an answer for this question type (what "required" checks). */
export function isAnswered(type: string, value: unknown): boolean {
  if (isContentQuestion(type) || value === undefined) return false
  switch (type) {
    case 'phone':
      return isObj(value) ? nonBlankStr(value.number) : !isEmpty(value)
    case 'birthday':
      return isObj(value) ? ['day', 'month', 'year'].some(k => nonBlankStr(value[k]) || typeof value[k] === 'number') : !isEmpty(value)
    case 'address':
    case 'field_group':
      return isObj(value) ? anyNonBlankField(value) : !isEmpty(value)
    case 'grid_radio':
    case 'grid_checkbox':
      return isObj(value) ? Object.values(value).some(x => !isEmpty(x)) : !isEmpty(value)
    case 'file_upload':
      return isObj(value) ? nonBlankStr(value.fileId) : !isEmpty(value)
    default:
      return !isEmpty(value)
  }
}

const EMAIL_LOCAL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/
const EMAIL_LABEL = /^[A-Za-z0-9-]{1,63}$/

/** The browser's definition of a valid e-mail address (HTML, input type=email). */
export function isValidEmail(s: string): boolean {
  const at = s.indexOf('@')
  if (at < 0) return false
  const local = s.slice(0, at)
  const domain = s.slice(at + 1)
  return EMAIL_LOCAL.test(local) && domain !== '' &&
    domain.split('.').every(l => EMAIL_LABEL.test(l) && !l.startsWith('-') && !l.endsWith('-'))
}

/** An absolute URL: a scheme, a colon, then something, without whitespace or control characters. */
export function isValidUrl(s: string): boolean {
  const colon = s.indexOf(':')
  if (colon < 0) return false
  return /^[A-Za-z][A-Za-z0-9+.-]*$/.test(s.slice(0, colon)) && colon + 1 < s.length && !/[\s\p{Cc}]/u.test(s)
}

const isPhoneNumber = (s: string) => (s.match(/[0-9]/g)?.length ?? 0) >= 3 && /^[0-9 +\-().,/]*$/.test(s)
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
function daysInMonth(m: number, year: number | null): number {
  if ([1, 3, 5, 7, 8, 10, 12].includes(m)) return 31
  if ([4, 6, 9, 11].includes(m)) return 30
  if (m === 2) return year != null && !isLeap(year) ? 28 : 29
  return 0
}
const digitsValue = (s: string, maxLen: number): number | null =>
  s !== '' && s.length <= maxLen && /^[0-9]+$/.test(s) ? Number(s) : null

/** `YYYY-MM-DD`, a real calendar day. */
export function isValidDate(s: string): boolean {
  const p = s.split('-')
  if (p.length !== 3 || p[0].length !== 4 || p[1].length !== 2 || p[2].length !== 2) return false
  const y = digitsValue(p[0], 4), m = digitsValue(p[1], 2), d = digitsValue(p[2], 2)
  return y != null && m != null && d != null && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(m, y)
}

/** `H:MM` or `HH:MM`, optional `:SS`, optional AM/PM (12-hour clock). */
export function isValidTime(s: string): boolean {
  const upper = s.replace(/[a-z]/g, c => c.toUpperCase())
  const twelve = upper.endsWith('AM') || upper.endsWith('PM')
  const clock = twelve ? upper.slice(0, -2).trimEnd() : upper
  const parts = clock.split(':')
  if (parts.length < 2 || parts.length > 3 || parts[0] === '' || parts[0].length > 2) return false
  const h = digitsValue(parts[0], 2)
  if (h == null) return false
  const minutesOk = parts.slice(1).every(p => p.length === 2 && (digitsValue(p, 2) ?? 99) <= 59)
  return minutesOk && (twelve ? h >= 1 && h <= 12 : h <= 23)
}

function text(v: unknown, max: number): IssueCode | null {
  if (typeof v !== 'string') return 'invalid_type'
  return chars(v) > max ? 'too_long' : null
}

function optionIds(options: Obj, key: string): string[] {
  const list = options[key]
  return Array.isArray(list) ? list.flatMap(o => (isObj(o) && typeof o.id === 'string' ? [o.id] : [])) : []
}

const optionNumber = (options: Obj, key: string, fallback: number) => {
  const v = options[key]
  return typeof v === 'number' ? v : fallback
}

function integerIn(v: unknown, min: number, max: number): IssueCode | null {
  if (typeof v !== 'number') return 'invalid_type'
  return !Number.isInteger(v) || v < min || v > max ? 'out_of_range' : null
}

/** The most serious of several problems, independent of the order of an object's keys. */
function worst(found: IssueCode[]): IssueCode | null {
  for (const c of ['invalid_type', 'invalid_choice', 'too_long'] as IssueCode[]) if (found.includes(c)) return c
  return null
}

function stringFields(o: Obj, allowed: string[] | null, max: number): IssueCode | null {
  const entries = Object.entries(o)
  if (entries.length > 50) return 'too_long'
  const found: IssueCode[] = []
  for (const [k, v] of entries) {
    if (allowed && !allowed.includes(k)) found.push('invalid_choice')
    if (v === null) continue
    if (typeof v === 'string') { if (chars(v) > max) found.push('too_long') } else found.push('invalid_type')
  }
  return worst(found)
}

/** A day, month or year field: null when blank, a number, or the problem. */
function datePart(v: unknown): number | null | IssueCode {
  if (v == null) return null
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return null
    return digitsValue(t, 4) ?? 'invalid_format'
  }
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 1e15 ? v : 'invalid_format'
  return 'invalid_type'
}

/** Checks the shape and range of a value that isAnswered accepted. Unknown question types accept any value. */
export function checkValue(question: LogicQuestion, value: unknown): IssueCode | null {
  const o: Obj = isObj(question.options) ? question.options : {}
  switch (question.question_type) {
    case 'short_text': return text(value, MAX_SHORT_TEXT)
    case 'long_text': return text(value, MAX_LONG_TEXT)
    case 'email': return text(value, MAX_LINK) ?? (isValidEmail((value as string).trim()) ? null : 'invalid_format')
    case 'url': return text(value, MAX_LINK) ?? (isValidUrl((value as string).trim()) ? null : 'invalid_format')
    case 'number':
      if (typeof value === 'number') return Number.isFinite(value) ? null : 'invalid_type'
      if (typeof value === 'string') return Number.isFinite(Number(value)) ? null : 'invalid_format'
      return 'invalid_type'
    case 'phone': {
      let number: string
      if (typeof value === 'string') number = value
      else if (isObj(value) && typeof value.number === 'string') {
        number = value.number
        for (const key of ['country', 'label']) {
          const f = value[key]
          if (f == null) continue
          if (typeof f !== 'string') return 'invalid_type'
          if (chars(f) > MAX_ATTRIBUTE) return 'too_long'
        }
      } else return 'invalid_type'
      const n = number.trim()
      if (chars(n) > MAX_PHONE) return 'too_long'
      return isPhoneNumber(n) ? null : 'invalid_format'
    }
    case 'multiple_choice':
    case 'dropdown':
      if (typeof value !== 'string') return 'invalid_type'
      return optionIds(o, 'options').includes(value) ? null : 'invalid_choice'
    case 'checkbox':
    case 'ranking': {
      if (!Array.isArray(value)) return 'invalid_type'
      const ids = optionIds(o, 'options')
      const seen = new Set<string>()
      for (const item of value) {
        if (typeof item !== 'string') return 'invalid_type'
        if (!ids.includes(item) || seen.has(item)) return 'invalid_choice'
        seen.add(item)
      }
      return null
    }
    case 'yes_no':
      if (typeof value !== 'string') return 'invalid_type'
      return value === 'yes' || value === 'no' ? null : 'invalid_choice'
    case 'linear_scale': return integerIn(value, optionNumber(o, 'min', 1), optionNumber(o, 'max', 5))
    case 'opinion_scale': return integerIn(value, optionNumber(o, 'min', 0), optionNumber(o, 'max', 10))
    case 'rating': return integerIn(value, 1, optionNumber(o, 'max', 5))
    case 'date':
      if (typeof value !== 'string') return 'invalid_type'
      return isValidDate(value.trim()) ? null : 'invalid_format'
    case 'time':
      if (typeof value !== 'string') return 'invalid_type'
      return isValidTime(value.trim()) ? null : 'invalid_format'
    case 'birthday': {
      if (!isObj(value)) return 'invalid_type'
      if (typeof value.label === 'string' && chars(value.label) > MAX_ATTRIBUTE) return 'too_long'
      const day = datePart(value.day)
      if (typeof day === 'string') return day
      const month = datePart(value.month)
      if (typeof month === 'string') return month
      const year = datePart(value.year)
      if (typeof year === 'string') return year
      if (day == null || month == null) return 'invalid_format'
      if (year != null && (year < 1000 || year > 9999)) return 'out_of_range'
      return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month, year) ? null : 'invalid_format'
    }
    case 'address':
      return isObj(value) ? stringFields(value, null, MAX_SHORT_TEXT) : 'invalid_type'
    case 'field_group': {
      if (!isObj(value)) return 'invalid_type'
      const fields = o.fields
      const keys = Array.isArray(fields) ? fields.flatMap(f => (isObj(f) && typeof f.key === 'string' ? [f.key] : [])) : []
      return stringFields(value, keys.length ? keys : null, MAX_SHORT_TEXT)
    }
    case 'grid_radio':
    case 'grid_checkbox': {
      if (!isObj(value)) return 'invalid_type'
      const rows = optionIds(o, 'rows'), cols = optionIds(o, 'columns')
      const multi = question.question_type === 'grid_checkbox'
      const found: IssueCode[] = []
      for (const [row, cell] of Object.entries(value)) {
        if (!rows.includes(row)) found.push('invalid_choice')
        let picked: unknown[] = []
        if (cell === null) picked = []
        else if (!multi && typeof cell === 'string') picked = [cell]
        else if (multi && Array.isArray(cell)) picked = cell
        else found.push('invalid_type')
        const seen = new Set<string>()
        for (const c of picked) {
          if (typeof c !== 'string') found.push('invalid_type')
          else if (!cols.includes(c) || seen.has(c)) found.push('invalid_choice')
          else seen.add(c)
        }
      }
      return worst(found)
    }
    case 'file_upload':
      if (!isObj(value) || typeof value.fileId !== 'string') return 'invalid_type'
      return chars(value.fileId) > MAX_ATTRIBUTE ? 'too_long' : null
    case 'signature':
      if (typeof value !== 'string') return 'invalid_type'
      if (chars(value) > MAX_SIGNATURE) return 'too_long'
      return value.startsWith('data:image/png;base64,') ? null : 'invalid_format'
    default:
      return null
  }
}

/** The verdict on one value: whether it counts as an answer and, if so, its first problem. */
export function checkAnswer(question: LogicQuestion, value: unknown): { answered: boolean; issue: IssueCode | null } {
  const answered = isAnswered(question.question_type, value)
  return { answered, issue: answered ? checkValue(question, value) : null }
}

/** Code-point order (the server sorts ids as Rust strings do). */
export function compareIds(a: string, b: string): number {
  const x = [...a], y = [...b]
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0)
    if (d !== 0) return d
  }
  return x.length - y.length
}

export interface SubmissionVerdict {
  /** Problems, in form order; empty when the submission is accepted. */
  issues:   Issue[]
  /** Answers to store, in submission order. */
  accepted: string[]
  /** Answers dropped (unknown, content, not reached, blank), sorted. */
  ignored:  string[]
}

/**
 * Validates a whole submission exactly as the server does: answers to the questions the respondent reached
 * are checked, every reached required question must be answered, everything else is ignored.
 */
export function validateSubmission(
  questions: LogicQuestion[],
  rules: LogicRule[],
  mode: FlowMode,
  answers: { question_id: string; value: unknown }[],
): SubmissionVerdict {
  const map: Answers = {}
  const duplicates = new Set<string>()
  for (const a of answers) {
    if (Object.prototype.hasOwnProperty.call(map, a.question_id)) duplicates.add(a.question_id)
    map[a.question_id] = a.value
  }
  const byId = new Map(questions.map(q => [q.id, q]))
  const reached = new Set(reachedQuestions(questions, rules, map, mode).map(q => q.id))
  const issues: Issue[] = []
  for (const q of questions) {
    if (!reached.has(q.id) || isContentQuestion(q.question_type)) continue
    if (duplicates.has(q.id)) { issues.push({ question_id: q.id, code: 'duplicate_answer' }); continue }
    const verdict = checkAnswer(q, Object.prototype.hasOwnProperty.call(map, q.id) ? map[q.id] : undefined)
    if (verdict.issue) issues.push({ question_id: q.id, code: verdict.issue })
    else if (q.required && !verdict.answered) issues.push({ question_id: q.id, code: 'required' })
  }
  const accepted: string[] = []
  const ignored = new Set<string>()
  const taken = new Set<string>()
  for (const a of answers) {
    const q = byId.get(a.question_id)
    const keep = !!q && !isContentQuestion(q.question_type) && reached.has(q.id) && isAnswered(q.question_type, a.value)
    if (keep && !taken.has(a.question_id)) { taken.add(a.question_id); accepted.push(a.question_id) }
    else if (!keep) ignored.add(a.question_id)
  }
  return { issues, accepted, ignored: [...ignored].sort(compareIds) }
}
