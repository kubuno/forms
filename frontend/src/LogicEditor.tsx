// Visual editor for conditional logic rules: "If <question> <operator> <value>
// then <action> <target>". Branching powers both the classic and Typeform shells.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, GitBranch } from 'lucide-react'
import { formsApi, type Question, type ConditionalRule, type RuleOperator, type RuleAction } from './api'

const OPERATORS: Array<{ value: RuleOperator; label: string; needsValue: boolean }> = [
  { value: 'equals',           label: 'est égal à',          needsValue: true },
  { value: 'not_equals',       label: "n'est pas égal à",    needsValue: true },
  { value: 'contains',         label: 'contient',            needsValue: true },
  { value: 'not_contains',     label: 'ne contient pas',     needsValue: true },
  { value: 'starts_with',      label: 'commence par',        needsValue: true },
  { value: 'ends_with',        label: 'finit par',           needsValue: true },
  { value: 'greater_than',     label: 'est supérieur à',     needsValue: true },
  { value: 'greater_or_equal', label: 'est supérieur ou égal à', needsValue: true },
  { value: 'less_than',        label: 'est inférieur à',     needsValue: true },
  { value: 'less_or_equal',    label: 'est inférieur ou égal à', needsValue: true },
  { value: 'is_empty',         label: 'est vide',            needsValue: false },
  { value: 'is_not_empty',     label: "n'est pas vide",      needsValue: false },
]

const ACTIONS: Array<{ value: RuleAction; label: string; needsTarget: boolean }> = [
  { value: 'skip_to_question', label: 'aller à la question', needsTarget: true },
  { value: 'show_section',     label: 'afficher',            needsTarget: true },
  { value: 'hide_section',     label: 'masquer',             needsTarget: true },
  { value: 'jump_to_thankyou', label: 'aller au remerciement', needsTarget: false },
  { value: 'submit_form',      label: 'envoyer le formulaire', needsTarget: false },
]

const CHOICE_TYPES = ['multiple_choice', 'checkbox', 'dropdown', 'yes_no', 'ranking']

export default function LogicEditor({ formId, questions, color }: { formId: string; questions: Question[]; color: string }) {
  const qc = useQueryClient()
  const { data: rules = [] } = useQuery({
    queryKey: ['forms-rules', formId],
    queryFn:  () => formsApi.listRules(formId).then(r => r.data.rules),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['forms-rules', formId] })
  const createMut = useMutation({ mutationFn: (d: Parameters<typeof formsApi.createRule>[1]) => formsApi.createRule(formId, d), onSuccess: invalidate })
  const updateMut = useMutation({ mutationFn: ({ id, d }: { id: string; d: Parameters<typeof formsApi.updateRule>[2] }) => formsApi.updateRule(formId, id, d), onSuccess: invalidate })
  const deleteMut = useMutation({ mutationFn: (id: string) => formsApi.deleteRule(formId, id), onSuccess: invalidate })

  const answerable = questions.filter(q => !['section', 'statement', 'welcome_screen', 'thank_you_screen', 'image', 'video'].includes(q.question_type))
  const qLabel = (id: string) => {
    const q = questions.find(x => x.id === id)
    return q ? (q.title || 'Sans titre') : '—'
  }

  const addRule = () => {
    if (!answerable.length) return
    createMut.mutate({
      trigger_question_id: answerable[0].id,
      operator: 'equals',
      compare_value: '',
      action: 'skip_to_question',
      target_section_id: questions[questions.length - 1]?.id ?? null,
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-1">
          <GitBranch size={18} style={{ color }} />
          <h3 className="text-base font-medium text-gray-800">Logique conditionnelle</h3>
        </div>
        <p className="text-sm text-gray-500">Créez des règles de branchement : sautez, affichez ou masquez des questions selon les réponses.</p>
      </div>

      {rules.map(rule => (
        <RuleRow key={rule.id} rule={rule} questions={questions} answerable={answerable} qLabel={qLabel} color={color}
          onChange={(d) => updateMut.mutate({ id: rule.id, d })}
          onDelete={() => deleteMut.mutate(rule.id)} />
      ))}

      <button onClick={addRule} disabled={!answerable.length}
        className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-white border border-gray-300 text-gray-700 hover:border-gray-400 hover:shadow-sm transition-all disabled:opacity-50">
        <Plus size={16} /> Ajouter une règle
      </button>
      {!answerable.length && <p className="text-sm text-gray-400">Ajoutez d'abord des questions au formulaire.</p>}
    </div>
  )
}

function RuleRow({ rule, questions, answerable, qLabel, color, onChange, onDelete }: {
  rule: ConditionalRule
  questions: Question[]
  answerable: Question[]
  qLabel: (id: string) => string
  color: string
  onChange: (d: Partial<Pick<ConditionalRule, 'operator' | 'compare_value' | 'action' | 'target_section_id'>>) => void
  onDelete: () => void
}) {
  const trigger = questions.find(q => q.id === rule.trigger_question_id)
  const opMeta = OPERATORS.find(o => o.value === rule.operator)
  const actMeta = ACTIONS.find(a => a.value === rule.action)
  const triggerOpts = (trigger?.options?.options as Array<{ id: string; label: string }>) ?? []
  const isChoice = trigger && CHOICE_TYPES.includes(trigger.question_type)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-gray-500">Si</span>
      <Select value={rule.trigger_question_id} onChange={() => {}} disabled
        options={answerable.map(q => ({ value: q.id, label: q.title || 'Sans titre' }))} />

      <Select value={rule.operator} onChange={v => onChange({ operator: v as RuleOperator })}
        options={OPERATORS.map(o => ({ value: o.value, label: o.label }))} />

      {opMeta?.needsValue && (
        trigger?.question_type === 'yes_no' ? (
          <Select value={String(rule.compare_value ?? '')} onChange={v => onChange({ compare_value: v })}
            options={[{ value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }]} />
        ) : isChoice && triggerOpts.length ? (
          <Select value={String(rule.compare_value ?? '')} onChange={v => onChange({ compare_value: v })}
            options={triggerOpts.map(o => ({ value: o.id, label: o.label }))} />
        ) : (
          <input defaultValue={String(rule.compare_value ?? '')} onBlur={e => onChange({ compare_value: e.target.value })}
            placeholder="valeur" className="border border-gray-300 rounded-lg px-2 py-1 text-sm outline-none focus:border-gray-500 w-28" />
        )
      )}

      <span className="text-gray-500">alors</span>
      <Select value={rule.action} onChange={v => onChange({ action: v as RuleAction })}
        options={ACTIONS.map(a => ({ value: a.value, label: a.label }))} color={color} />

      {actMeta?.needsTarget && (
        <Select value={rule.target_section_id ?? ''} onChange={v => onChange({ target_section_id: v || null })}
          options={questions.map(q => ({ value: q.id, label: q.title || qLabel(q.id) }))} />
      )}

      <button onClick={onDelete} className="ml-auto text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
    </div>
  )
}

function Select({ value, onChange, options, disabled, color }: {
  value: string; onChange: (v: string) => void
  options: Array<{ value: string; label: string }>; disabled?: boolean; color?: string
}) {
  return (
    <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
      className="border border-gray-300 rounded-lg px-2 py-1 text-sm outline-none focus:border-gray-500 disabled:bg-gray-50 disabled:text-gray-600 max-w-44"
      style={color ? { color } : undefined}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
