// Per-question configuration shown inside an active question card in the editor:
// choice options, scale settings, ranking, grids, content button labels, and
// (in quiz mode) points / correct answers / feedback.
import { Plus, X, Check, Trophy } from 'lucide-react'
import type { Question } from './api'
import { getMeta, genId } from './questionTypes'

interface Opt { id: string; label: string }

interface Props {
  question: Question
  color:    string
  quizMode: boolean
  onUpdate: (patch: Partial<Question>) => void
}

export default function OptionsEditor({ question, color, quizMode, onUpdate }: Props) {
  const meta = getMeta(question.question_type)
  const o = (question.options ?? {}) as Record<string, unknown>
  const patchOptions = (changes: Record<string, unknown>) =>
    onUpdate({ options: { ...o, ...changes } })

  return (
    <div className="space-y-4">
      {meta.hasOptions && !question.question_type.startsWith('grid') && (
        <ChoiceOptions question={question} color={color} quizMode={quizMode} onUpdate={onUpdate} patchOptions={patchOptions} />
      )}

      {question.question_type.startsWith('grid') && (
        <GridOptions o={o} patchOptions={patchOptions} />
      )}

      {(question.question_type === 'linear_scale' || question.question_type === 'opinion_scale') && (
        <ScaleOptions question={question} o={o} quizMode={quizMode} patchOptions={patchOptions} onUpdate={onUpdate} />
      )}

      {question.question_type === 'rating' && (
        <RatingOptions question={question} o={o} quizMode={quizMode} patchOptions={patchOptions} onUpdate={onUpdate} />
      )}

      {question.question_type === 'yes_no' && quizMode && (
        <YesNoCorrect question={question} onUpdate={onUpdate} color={color} />
      )}

      {['short_text', 'number', 'email'].includes(question.question_type) && quizMode && getMeta(question.question_type).supportsQuiz && (
        <TextCorrect question={question} onUpdate={onUpdate} />
      )}

      {(question.question_type === 'welcome_screen' || question.question_type === 'statement') && (
        <LabeledInput label="Texte du bouton" value={(o.buttonText as string) ?? ''} placeholder={question.question_type === 'welcome_screen' ? 'Commencer' : 'Continuer'} onChange={v => patchOptions({ buttonText: v })} />
      )}

      {/* Quiz points + feedback */}
      {quizMode && meta.supportsQuiz && (
        <QuizSettings question={question} color={color} onUpdate={onUpdate} />
      )}
    </div>
  )
}

// ── Choice options (radio / checkbox / dropdown / ranking) ───────────────────────

function ChoiceOptions({ question, color, quizMode, onUpdate, patchOptions }: {
  question: Question; color: string; quizMode: boolean
  onUpdate: (p: Partial<Question>) => void; patchOptions: (c: Record<string, unknown>) => void
}) {
  const opts = ((question.options?.options as Opt[]) ?? [])
  const correct = (question.correct_answers as string[]) ?? []
  const isMulti = question.question_type === 'checkbox'
  const canScore = quizMode && question.question_type !== 'ranking'

  const update = (next: Opt[]) => patchOptions({ options: next })
  const setLabel = (id: string, label: string) => update(opts.map(op => op.id === id ? { ...op, label } : op))
  const add = () => update([...opts, { id: genId(), label: `Option ${opts.length + 1}` }])
  const remove = (id: string) => {
    update(opts.filter(op => op.id !== id))
    if (canScore) onUpdate({ correct_answers: correct.filter(c => c !== id) })
  }
  const toggleCorrect = (id: string) => {
    if (!canScore) return
    if (isMulti) onUpdate({ correct_answers: correct.includes(id) ? correct.filter(c => c !== id) : [...correct, id] })
    else onUpdate({ correct_answers: [id] })
  }

  return (
    <div className="space-y-2">
      {opts.map(op => {
        const isCorrect = correct.includes(op.id)
        return (
          <div key={op.id} className="flex items-center gap-2">
            <span className={`w-4 h-4 border-2 border-gray-300 shrink-0 ${isMulti ? 'rounded' : 'rounded-full'}`} />
            <input value={op.label} onChange={e => setLabel(op.id, e.target.value)}
              className="flex-1 text-sm text-gray-700 border-b border-transparent hover:border-gray-300 focus:border-gray-500 outline-none py-1 bg-transparent" />
            {canScore && (
              <button onClick={() => toggleCorrect(op.id)} title="Marquer comme bonne réponse"
                className="w-6 h-6 rounded-full flex items-center justify-center border transition-colors"
                style={{ borderColor: isCorrect ? '#16a34a' : '#d1d5db', backgroundColor: isCorrect ? '#16a34a' : 'transparent', color: isCorrect ? 'white' : '#9ca3af' }}>
                <Check size={13} />
              </button>
            )}
            <button onClick={() => remove(op.id)} className="text-gray-400 hover:text-red-500"><X size={16} /></button>
          </div>
        )
      })}
      <button onClick={add} className="flex items-center gap-1.5 text-sm" style={{ color }}>
        <Plus size={15} /> Ajouter une option
      </button>
    </div>
  )
}

// ── Grids ────────────────────────────────────────────────────────────────────

function GridOptions({ o, patchOptions }: { o: Record<string, unknown>; patchOptions: (c: Record<string, unknown>) => void }) {
  const rows = (o.rows as Opt[]) ?? []
  const cols = (o.columns as Opt[]) ?? []
  const editList = (key: 'rows' | 'columns', list: Opt[]) => patchOptions({ [key]: list })
  return (
    <div className="grid grid-cols-2 gap-4">
      {(['rows', 'columns'] as const).map(key => {
        const list = key === 'rows' ? rows : cols
        return (
          <div key={key}>
            <p className="text-xs font-medium text-gray-500 mb-2">{key === 'rows' ? 'Lignes' : 'Colonnes'}</p>
            <div className="space-y-1.5">
              {list.map(item => (
                <div key={item.id} className="flex items-center gap-1">
                  <input value={item.label} onChange={e => editList(key, list.map(l => l.id === item.id ? { ...l, label: e.target.value } : l))}
                    className="flex-1 text-sm border-b border-gray-200 focus:border-gray-500 outline-none py-0.5 bg-transparent" />
                  <button onClick={() => editList(key, list.filter(l => l.id !== item.id))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                </div>
              ))}
              <button onClick={() => editList(key, [...list, { id: genId(), label: `${key === 'rows' ? 'Ligne' : 'Colonne'} ${list.length + 1}` }])}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"><Plus size={13} /> Ajouter</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Scale / rating ───────────────────────────────────────────────────────────

function ScaleOptions({ question, o, quizMode, patchOptions, onUpdate }: {
  question: Question; o: Record<string, unknown>; quizMode: boolean
  patchOptions: (c: Record<string, unknown>) => void; onUpdate: (p: Partial<Question>) => void
}) {
  const min = (o.min as number) ?? (question.question_type === 'opinion_scale' ? 0 : 1)
  const max = (o.max as number) ?? (question.question_type === 'opinion_scale' ? 10 : 5)
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <NumberField label="De" value={min} onChange={v => patchOptions({ min: v })} />
        <NumberField label="À" value={max} onChange={v => patchOptions({ max: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <LabeledInput label="Étiquette min." value={(o.minLabel as string) ?? ''} onChange={v => patchOptions({ minLabel: v })} />
        <LabeledInput label="Étiquette max." value={(o.maxLabel as string) ?? ''} onChange={v => patchOptions({ maxLabel: v })} />
      </div>
      {quizMode && <NumberField label="Bonne réponse" value={(question.correct_answers as number[])?.[0] ?? min} onChange={v => onUpdate({ correct_answers: [v] })} />}
    </div>
  )
}

function RatingOptions({ question, o, quizMode, patchOptions, onUpdate }: {
  question: Question; o: Record<string, unknown>; quizMode: boolean
  patchOptions: (c: Record<string, unknown>) => void; onUpdate: (p: Partial<Question>) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <NumberField label="Nombre d'icônes" value={(o.max as number) ?? 5} onChange={v => patchOptions({ max: Math.max(2, Math.min(10, v)) })} />
        <div>
          <p className="text-xs text-gray-500 mb-1">Icône</p>
          <select value={(o.icon as string) ?? 'star'} onChange={e => patchOptions({ icon: e.target.value })}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm outline-none">
            <option value="star">Étoile</option>
            <option value="heart">Cœur</option>
          </select>
        </div>
      </div>
      {quizMode && <NumberField label="Bonne réponse" value={(question.correct_answers as number[])?.[0] ?? 5} onChange={v => onUpdate({ correct_answers: [v] })} />}
    </div>
  )
}

function YesNoCorrect({ question, onUpdate, color }: { question: Question; onUpdate: (p: Partial<Question>) => void; color: string }) {
  const correct = (question.correct_answers as string[])?.[0]
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">Bonne réponse</p>
      <div className="flex gap-2">
        {[{ id: 'yes', label: 'Oui' }, { id: 'no', label: 'Non' }].map(it => (
          <button key={it.id} onClick={() => onUpdate({ correct_answers: [it.id] })}
            className="px-4 py-1.5 rounded-lg border text-sm"
            style={{ borderColor: correct === it.id ? color : '#d1d5db', color: correct === it.id ? color : '#374151' }}>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function TextCorrect({ question, onUpdate }: { question: Question; onUpdate: (p: Partial<Question>) => void }) {
  const accepted = (question.correct_answers as string[]) ?? []
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">Réponses acceptées (une par ligne)</p>
      <textarea
        defaultValue={accepted.join('\n')}
        onBlur={e => onUpdate({ correct_answers: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
        rows={2}
        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm outline-none resize-none"
        placeholder="ex. Paris"
      />
    </div>
  )
}

function QuizSettings({ question, color, onUpdate }: { question: Question; color: string; onUpdate: (p: Partial<Question>) => void }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <Trophy size={15} style={{ color }} /> Quiz
      </div>
      <NumberField label="Points" value={question.points} onChange={v => onUpdate({ points: Math.max(0, v) })} />
      <div className="grid grid-cols-2 gap-3">
        <LabeledInput label="Message si correct" value={question.feedback_correct ?? ''} onChange={v => onUpdate({ feedback_correct: v || null })} />
        <LabeledInput label="Message si incorrect" value={question.feedback_incorrect ?? ''} onChange={v => onUpdate({ feedback_incorrect: v || null })} />
      </div>
    </div>
  )
}

// ── Small fields ─────────────────────────────────────────────────────────────

function LabeledInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <input defaultValue={value} placeholder={placeholder} onBlur={e => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-gray-500" />
    </div>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-gray-500" />
    </div>
  )
}
