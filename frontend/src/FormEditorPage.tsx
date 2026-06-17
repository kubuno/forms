import { useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Eye, Send, Plus, Trash2, Copy, GripVertical, ChevronDown,
  ToggleLeft, ToggleRight, ArrowLeft, BarChart2, ClipboardList,
  Trophy, Star, Heart, Check,
} from 'lucide-react'
import { formsApi, type Form, type Question, type QuestionType } from './api'
import { DatePicker } from '@ui'
import {
  QUESTION_TYPES, GROUP_LABELS, getMeta, defaultOptionsFor, isContentType,
  type QTypeGroup,
} from './questionTypes'
import OptionsEditor from './OptionsEditor'
import LogicEditor from './LogicEditor'

const FORM_COLORS = [
  '#db4437', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#1a73e8',
  '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39',
  '#ffc107', '#ff9800', '#795548', '#607d8b', '#111827', '#0f766e',
]

const FONTS = [
  { label: 'DM Sans (défaut)', value: 'DM Sans, Inter, system-ui, sans-serif' },
  { label: 'Inter',            value: 'Inter, system-ui, sans-serif' },
  { label: 'Georgia (serif)',  value: 'Georgia, "Times New Roman", serif' },
  { label: 'Système',          value: 'system-ui, sans-serif' },
  { label: 'Monospace',        value: '"DM Mono", "Courier New", monospace' },
]

type Tab = 'questions' | 'responses' | 'logic' | 'settings'

export default function FormEditorPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const [activeTab, setActiveTab]               = useState<Tab>('questions')
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null)
  const [showThemePicker, setShowThemePicker]   = useState(false)
  const dragId = useRef<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['form', id],
    queryFn:  () => formsApi.get(id!).then(r => r.data),
    enabled:  !!id,
  })

  const updateFormMut = useMutation({
    mutationFn: (patch: Parameters<typeof formsApi.update>[1]) => formsApi.update(id!, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['form', id] }),
  })
  const createQuestionMut = useMutation({
    mutationFn: (type: QuestionType) => formsApi.createQuestion(id!, { question_type: type }),
    onSuccess:  async (r) => {
      // Seed default options for the new question type.
      const opts = defaultOptionsFor(r.data.question.question_type)
      if (Object.keys(opts).length) await formsApi.updateQuestion(id!, r.data.question.id, { options: opts })
      qc.invalidateQueries({ queryKey: ['form', id] })
      setActiveQuestionId(r.data.question.id)
    },
  })
  const updateQuestionMut = useMutation({
    mutationFn: ({ qid, patch }: { qid: string; patch: Partial<Question> }) => formsApi.updateQuestion(id!, qid, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['form', id] }),
  })
  const deleteQuestionMut = useMutation({
    mutationFn: (qid: string) => formsApi.deleteQuestion(id!, qid),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['form', id] }); setActiveQuestionId(null) },
  })
  const duplicateQuestionMut = useMutation({
    mutationFn: (qid: string) => formsApi.duplicateQuestion(id!, qid),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['form', id] }),
  })
  const reorderMut = useMutation({
    mutationFn: (items: Array<{ id: string; position: number }>) => formsApi.reorderQuestions(id!, items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['form', id] }),
  })

  const form      = data?.form
  const questions = data?.questions ?? []
  const color     = (form?.theme as { primaryColor?: string })?.primaryColor ?? '#673ab7'
  const quizMode  = !!form?.settings?.quizMode

  const debounceUpdate = useCallback(
    (patch: Parameters<typeof formsApi.update>[1]) => updateFormMut.mutate(patch),
    [updateFormMut],
  )

  // Native drag & drop reorder.
  const onDrop = (targetId: string) => {
    const src = dragId.current
    dragId.current = null
    if (!src || src === targetId) return
    const ids = questions.map(q => q.id)
    const from = ids.indexOf(src), to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    reorderMut.mutate(ids.map((qid, i) => ({ id: qid, position: i })))
  }

  if (isLoading) return <div className="flex items-center justify-center h-full"><p className="text-sm text-text-tertiary">Chargement du formulaire…</p></div>
  if (!form) return null

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'questions', label: 'Questions' },
    { key: 'responses', label: `Réponses${form.response_count > 0 ? ` (${form.response_count})` : ''}` },
    { key: 'logic',     label: 'Logique' },
    { key: 'settings',  label: 'Paramètres' },
  ]

  return (
    <div className="min-h-full flex flex-col" style={{ background: '#f0ebf8', fontFamily: 'DM Sans, Inter, sans-serif' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/forms')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"><ArrowLeft size={18} /></button>
            <ClipboardList size={26} style={{ color }} />
            <input defaultValue={form.title}
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== form.title) debounceUpdate({ title: v }) }}
              className="text-gray-800 font-medium bg-transparent border-0 outline-none border-b border-transparent hover:border-gray-400 focus:border-blue-500 text-base min-w-32 max-w-64"
              placeholder="Titre du formulaire" />
          </div>

          <div className="flex items-center gap-1">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`px-3.5 py-1.5 text-sm rounded-full transition-colors ${activeTab === t.key ? 'text-white font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
                style={activeTab === t.key ? { backgroundColor: color } : {}}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowThemePicker(v => !v)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title="Thème">
              <div className="w-4 h-4 rounded-full border-2 border-white shadow" style={{ backgroundColor: color }} />
            </button>
            <a href={`/forms/public/${form.public_token}`} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title="Aperçu"><Eye size={18} /></a>
            <button onClick={() => { formsApi.publish(id!, !form.published_at).then(() => qc.invalidateQueries({ queryKey: ['form', id] })) }}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white rounded-full" style={{ backgroundColor: color }}>
              <Send size={14} /> {form.published_at ? 'Publié' : 'Publier'}
            </button>
          </div>
        </div>

        {showThemePicker && (
          <ThemePanel form={form} color={color} onClose={() => setShowThemePicker(false)}
            onUpdate={patch => updateFormMut.mutate(patch)} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 max-w-3xl mx-auto w-full py-6 px-4 relative">
        {activeTab === 'questions' && (
          <>
            <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm mb-4">
              <div className="h-10 w-full" style={{ backgroundColor: color }} />
              <div className="px-6 py-5 border-t-4" style={{ borderColor: color }}>
                <input defaultValue={form.title}
                  onBlur={e => { const v = e.target.value.trim(); if (v && v !== form.title) debounceUpdate({ title: v }) }}
                  placeholder="Titre du formulaire"
                  className="w-full text-gray-800 text-2xl bg-transparent border-0 outline-none border-b border-transparent hover:border-gray-400 focus:border-blue-500 pb-1 mb-4 placeholder-gray-400" />
                <input defaultValue={form.description ?? ''}
                  onBlur={e => debounceUpdate({ description: e.target.value || null })}
                  placeholder="Description du formulaire"
                  className="w-full text-gray-600 text-sm bg-transparent border-0 outline-none border-b border-transparent hover:border-gray-400 focus:border-blue-500 placeholder-gray-400" />
              </div>
            </div>

            <div className="space-y-3">
              {questions.map(q => (
                <div key={q.id}
                  draggable
                  onDragStart={() => { dragId.current = q.id }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => onDrop(q.id)}>
                  <QuestionCard
                    question={q}
                    isActive={activeQuestionId === q.id}
                    primaryColor={color}
                    quizMode={quizMode}
                    onClick={() => setActiveQuestionId(activeQuestionId === q.id ? null : q.id)}
                    onUpdate={patch => updateQuestionMut.mutate({ qid: q.id, patch })}
                    onDelete={() => deleteQuestionMut.mutate(q.id)}
                    onDuplicate={() => duplicateQuestionMut.mutate(q.id)}
                  />
                </div>
              ))}
            </div>

            <div className="mt-4">
              <AddQuestionMenu color={color} onPick={t => createQuestionMut.mutate(t)} />
            </div>
          </>
        )}

        {activeTab === 'responses' && <ResponsesTab formId={id!} form={form} color={color} questions={questions} />}
        {activeTab === 'logic'     && <LogicEditor formId={id!} questions={questions} color={color} />}
        {activeTab === 'settings'  && <SettingsTab form={form} color={color} onUpdate={patch => updateFormMut.mutate({ settings: patch as Parameters<typeof formsApi.update>[1]['settings'] })} />}
      </div>
    </div>
  )
}

// ── Theme panel ────────────────────────────────────────────────────────────────

function ThemePanel({ form, color, onClose, onUpdate }: {
  form: Form; color: string; onClose: () => void; onUpdate: (p: Parameters<typeof formsApi.update>[1]) => void
}) {
  return (
    <div className="absolute top-14 right-4 z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-4 w-72">
      <p className="text-sm font-medium text-gray-800 mb-3">Couleur</p>
      <div className="grid grid-cols-9 gap-1.5 mb-4">
        {FORM_COLORS.map(c => (
          <button key={c}
            onClick={() => onUpdate({ theme: { ...form.theme, primaryColor: c, headerColor: c } as Parameters<typeof formsApi.update>[1]['theme'] })}
            className="w-7 h-7 rounded-full hover:scale-110 transition-transform border-2"
            style={{ backgroundColor: c, borderColor: color === c ? 'white' : 'transparent', outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: '2px' }} />
        ))}
      </div>
      <p className="text-sm font-medium text-gray-800 mb-2">Police</p>
      <select defaultValue={form.theme.fontFamily}
        onChange={e => onUpdate({ theme: { ...form.theme, fontFamily: e.target.value } as Parameters<typeof formsApi.update>[1]['theme'] })}
        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm outline-none mb-2">
        {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      <button onClick={onClose} className="w-full mt-2 text-sm text-gray-500 hover:text-gray-700">Fermer</button>
    </div>
  )
}

// ── Add-question menu (grouped) ─────────────────────────────────────────────────

function AddQuestionMenu({ color, onPick }: { color: string; onPick: (t: QuestionType) => void }) {
  const [open, setOpen] = useState(false)
  const groups: QTypeGroup[] = ['text', 'choice', 'scale', 'datetime', 'media', 'content']
  return (
    <div className="relative flex justify-center">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-white border border-gray-300 text-gray-700 hover:border-gray-400 hover:shadow-sm transition-all">
        <Plus size={16} /> Ajouter une question <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-2 z-30 bg-white border border-gray-200 rounded-xl shadow-xl p-2 w-[30rem] max-h-[28rem] overflow-y-auto grid grid-cols-2 gap-1">
            {groups.map(g => (
              <div key={g} className="contents">
                <div className="col-span-2 px-2 pt-2 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">{GROUP_LABELS[g]}</div>
                {QUESTION_TYPES.filter(t => t.group === g).map(t => (
                  <button key={t.value} onClick={() => { onPick(t.value); setOpen(false) }}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-gray-50 text-left text-sm text-gray-700">
                    <t.Icon size={16} style={{ color }} /> {t.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Question card ───────────────────────────────────────────────────────────────

function QuestionCard({ question, isActive, primaryColor, quizMode, onClick, onUpdate, onDelete, onDuplicate }: {
  question: Question; isActive: boolean; primaryColor: string; quizMode: boolean
  onClick: () => void; onUpdate: (p: Partial<Question>) => void; onDelete: () => void; onDuplicate: () => void
}) {
  const [showTypeMenu, setShowTypeMenu] = useState(false)
  const meta = getMeta(question.question_type)

  return (
    <div className={`rounded-xl bg-white border shadow-sm transition-all ${isActive ? 'shadow-md border-gray-300' : 'border-gray-200 hover:shadow-md'}`}
      style={isActive ? { borderLeft: `6px solid ${primaryColor}` } : {}} onClick={onClick}>
      <div className="p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1">
            {isActive ? (
              <input defaultValue={question.title}
                onBlur={e => { const v = e.target.value.trim(); if (v) onUpdate({ title: v }) }}
                onClick={e => e.stopPropagation()} placeholder="Question sans titre"
                className="w-full text-gray-800 text-base bg-gray-50 border-0 border-b border-gray-400 focus:border-blue-600 outline-none px-2 py-1 rounded-t" />
            ) : (
              <div className="text-base text-gray-800 flex items-center gap-2">
                <meta.Icon size={15} className="text-gray-400" />
                {question.title || <span className="text-gray-400">Question sans titre</span>}
                {question.required && <span className="text-red-500">*</span>}
                {quizMode && meta.supportsQuiz && question.points > 0 && (
                  <span className="text-xs text-gray-400 inline-flex items-center gap-0.5"><Trophy size={11} /> {question.points}</span>
                )}
              </div>
            )}
          </div>

          {isActive && (
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button onClick={() => setShowTypeMenu(v => !v)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:border-gray-400 text-gray-700">
                <meta.Icon size={15} /> {meta.label} <ChevronDown size={14} />
              </button>
              {showTypeMenu && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowTypeMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1 max-h-80 overflow-y-auto">
                    {QUESTION_TYPES.map(t => (
                      <button key={t.value}
                        onClick={() => {
                          // Reset options to the new type's defaults when switching kind.
                          const patch: Partial<Question> = { question_type: t.value }
                          if (t.value !== question.question_type) patch.options = defaultOptionsFor(t.value)
                          onUpdate(patch); setShowTypeMenu(false)
                        }}
                        className={`flex items-center gap-2 w-full px-3 py-2 text-sm ${question.question_type === t.value ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}>
                        <t.Icon size={15} /> {t.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {isActive && (
          <div className="mb-4" onClick={e => e.stopPropagation()}>
            <input defaultValue={question.description ?? ''}
              onBlur={e => onUpdate({ description: e.target.value || null })}
              placeholder="Description (facultatif)"
              className="w-full text-sm text-gray-600 bg-transparent border-b border-gray-200 focus:border-gray-400 outline-none py-1 mb-3" />
          </div>
        )}

        {isActive
          ? <div onClick={e => e.stopPropagation()}><OptionsEditor question={question} color={primaryColor} quizMode={quizMode} onUpdate={onUpdate} /></div>
          : <QuestionPreview question={question} />}
      </div>

      {isActive && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <button onClick={onDuplicate} className="p-1.5 rounded text-gray-500 hover:bg-gray-100" title="Dupliquer"><Copy size={16} /></button>
            <button onClick={onDelete} className="p-1.5 rounded text-gray-500 hover:text-red-500 hover:bg-red-50" title="Supprimer"><Trash2 size={16} /></button>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <GripVertical size={16} className="text-gray-400 cursor-grab" />
          </div>
          {!isContentType(question.question_type) && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Requis</span>
              <button onClick={() => onUpdate({ required: !question.required })} style={question.required ? { color: primaryColor } : { color: '#9ca3af' }}>
                {question.required ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function QuestionPreview({ question }: { question: Question }) {
  const opts = (question.options?.options as Array<{ id: string; label: string }>) ?? []
  switch (question.question_type) {
    case 'short_text': case 'email': case 'number': case 'phone': case 'url':
      return <div className="h-8 border-b border-gray-300 text-sm text-gray-400 flex items-end pb-1">Réponse</div>
    case 'long_text':
      return <div className="h-14 border-b border-gray-300 text-sm text-gray-400 flex items-end pb-1">Réponse longue</div>
    case 'multiple_choice': case 'checkbox': case 'dropdown': case 'ranking':
      return (
        <div className="space-y-2">
          {(opts.length ? opts : [{ id: '1', label: 'Option 1' }]).map(o => (
            <div key={o.id} className="flex items-center gap-2 text-sm text-gray-600">
              <div className={`w-4 h-4 border-2 border-gray-300 ${question.question_type === 'checkbox' ? 'rounded' : 'rounded-full'}`} />{o.label}
            </div>
          ))}
        </div>
      )
    case 'yes_no':
      return <div className="flex gap-2 text-sm text-gray-500"><span className="px-4 py-1 border border-gray-300 rounded-lg">Oui</span><span className="px-4 py-1 border border-gray-300 rounded-lg">Non</span></div>
    case 'linear_scale': case 'opinion_scale':
      return <div className="flex gap-2">{[1,2,3,4,5].map(n => <div key={n} className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center text-xs text-gray-500">{n}</div>)}</div>
    case 'rating': {
      const Icon = question.options?.icon === 'heart' ? Heart : Star
      return <div className="flex gap-1">{[1,2,3,4,5].map(n => <Icon key={n} size={22} className="text-gray-300" />)}</div>
    }
    case 'statement':
      return <div className="text-sm text-gray-400 italic">Bloc de texte informatif</div>
    case 'welcome_screen':
      return <div className="text-sm text-gray-400 italic">Écran d'accueil</div>
    case 'thank_you_screen':
      return <div className="text-sm text-gray-400 italic">Écran de remerciement</div>
    case 'section':
      return <div className="h-px bg-gray-200 my-2" />
    default: {
      const m = getMeta(question.question_type)
      return <div className="flex items-center gap-2 text-sm text-gray-400"><m.Icon size={16} /> {m.label}</div>
    }
  }
}

// ── Responses tab ───────────────────────────────────────────────────────────────

function ResponsesTab({ formId, form, color, questions }: { formId: string; form: Form; color: string; questions: Question[] }) {
  const [view, setView] = useState<'summary' | 'individual'>('summary')
  const { data: analyticsData } = useQuery({ queryKey: ['forms-analytics', formId], queryFn: () => formsApi.analytics(formId).then(r => r.data) })
  const { data: statsData } = useQuery({ queryKey: ['forms-stats', formId], queryFn: () => formsApi.questionStats(formId).then(r => r.data.stats), enabled: view === 'summary' })

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="text-3xl font-light text-gray-800 mb-1">{analyticsData?.total_responses ?? form.response_count}</div>
        <div className="text-sm text-gray-500">réponse{(analyticsData?.total_responses ?? form.response_count) !== 1 ? 's' : ''}</div>
        {!!analyticsData?.avg_fill_duration_secs && <div className="text-xs text-gray-400 mt-2">Durée moyenne : {Math.round(analyticsData.avg_fill_duration_secs)}s</div>}
      </div>

      <div className="flex gap-2">
        {(['summary', 'individual'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${view === v ? 'text-white border-transparent' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            style={view === v ? { backgroundColor: color, borderColor: color } : {}}>
            {v === 'summary' ? 'Résumé' : 'Individuel'}
          </button>
        ))}
        <a href={formsApi.exportCsvUrl(formId)} target="_blank" rel="noopener noreferrer"
          className="ml-auto px-4 py-1.5 text-sm rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 flex items-center gap-1.5">
          <BarChart2 size={14} /> Export CSV
        </a>
      </div>

      {view === 'summary' && statsData?.map(stat => (
        <div key={stat.question_id} className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-base text-gray-800 mb-1">{stat.title}</div>
          <div className="text-sm text-gray-500 mb-4">{stat.total_answers} réponse{stat.total_answers !== 1 ? 's' : ''}</div>
          {stat.stat_type === 'distribution' && stat.distribution && (
            <div className="space-y-2">
              {stat.distribution.map(d => (
                <div key={d.option_id}>
                  <div className="flex justify-between text-sm text-gray-700 mb-1"><span>{d.label}</span><span>{d.percentage}% ({d.count})</span></div>
                  <div className="h-5 bg-gray-100 rounded overflow-hidden"><div className="h-full rounded" style={{ width: `${d.percentage}%`, backgroundColor: color }} /></div>
                </div>
              ))}
            </div>
          )}
          {stat.stat_type === 'scale' && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Moyenne</span><span className="font-medium text-gray-800">{stat.mean?.toFixed(1)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Médiane</span><span className="font-medium text-gray-800">{stat.median}</span></div>
            </div>
          )}
          {stat.stat_type === 'text' && stat.texts && (
            <div className="space-y-2 max-h-64 overflow-y-auto">{stat.texts.map((t, i) => <div key={i} className="text-sm text-gray-700 border-b border-gray-100 pb-2">{t}</div>)}</div>
          )}
        </div>
      ))}

      {view === 'individual' && <IndividualResponseView formId={formId} questions={questions} color={color} />}
    </div>
  )
}

function IndividualResponseView({ formId, questions, color }: { formId: string; questions: Question[]; color: string }) {
  const [index, setIndex] = useState(0)
  const { data: totalData } = useQuery({ queryKey: ['forms-responses-total', formId], queryFn: () => formsApi.listResponses(formId, { limit: 1 }).then(r => r.data.total) })
  const total = totalData ?? 0

  const { data } = useQuery({
    queryKey: ['forms-response-individual', formId, index],
    queryFn:  () => formsApi.listResponses(formId, { limit: 1, offset: index }).then(async r => {
      if (r.data.responses[0]) return (await formsApi.getResponse(formId, r.data.responses[0].id)).data
      return null
    }),
    enabled: total > 0,
  })

  const labelFor = (qid: string) => questions.find(q => q.id === qid)?.title || qid
  const optLabel = (qid: string, val: unknown) => {
    const q = questions.find(x => x.id === qid)
    const opts = (q?.options?.options as Array<{ id: string; label: string }>) ?? []
    const lookup = (v: unknown) => opts.find(o => o.id === v)?.label ?? String(v)
    if (Array.isArray(val)) return val.map(lookup).join(', ')
    if (val && typeof val === 'object' && 'name' in (val as object)) return (val as { name: string }).name
    return lookup(val)
  }

  if (total === 0) return <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">Aucune réponse pour le moment.</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-600">{index + 1} / {total}</span>
        <div className="flex gap-2">
          <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50">← Précédent</button>
          <button onClick={() => setIndex(i => Math.min(total - 1, i + 1))} disabled={index >= total - 1} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50">Suivant →</button>
        </div>
      </div>
      {data && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-xs text-gray-400 mb-4 flex items-center gap-2">
            Soumis le {new Date(data.response.submitted_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {data.response.respondent_email && ` · ${data.response.respondent_email}`}
            {data.response.max_score != null && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-white text-xs" style={{ backgroundColor: color }}>
                <Trophy size={11} /> {data.response.score} / {data.response.max_score}
              </span>
            )}
          </div>
          <div className="space-y-4">
            {data.answers.map(a => (
              <div key={a.id}>
                <div className="text-xs text-gray-500 mb-1 flex items-center gap-1.5">
                  {labelFor(a.question_id)}
                  {a.is_correct === true && <Check size={12} className="text-green-600" />}
                  {a.is_correct === false && <span className="text-red-500 text-xs">✗</span>}
                </div>
                <div className="text-sm text-gray-800">
                  {a.value && typeof a.value === 'object' && 'fileId' in (a.value as object)
                    ? <a href={formsApi.uploadDownloadUrl(formId, (a.value as { fileId: string }).fileId)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{(a.value as { name: string }).name}</a>
                    : optLabel(a.question_id, a.value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Settings tab ────────────────────────────────────────────────────────────────

function SettingsTab({ form, color, onUpdate }: { form: Form; color: string; onUpdate: (s: Partial<Form['settings']>) => void }) {
  const s = form.settings
  const mode = s.displayMode ?? 'one_at_a_time'

  return (
    <div className="space-y-4">
      {/* Présentation */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h3 className="text-base font-medium text-gray-800">Présentation</h3>
        <div>
          <p className="text-sm text-gray-700 mb-2">Mode d'affichage</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { id: 'one_at_a_time', label: 'Une question à la fois', desc: 'Style Typeform, immersif' },
              { id: 'classic',       label: 'Toutes les questions',   desc: 'Style classique, défilement' },
            ] as const).map(opt => (
              <button key={opt.id} onClick={() => onUpdate({ displayMode: opt.id })}
                className="text-left rounded-xl border-2 p-3 transition-colors"
                style={{ borderColor: mode === opt.id ? color : '#e5e7eb' }}>
                <div className="text-sm font-medium text-gray-800">{opt.label}</div>
                <div className="text-xs text-gray-500">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <SettingToggle label="Afficher la barre de progression" value={s.showProgressBar} onChange={v => onUpdate({ showProgressBar: v })} color={color} />
      </div>

      {/* Quiz */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <div className="flex items-center gap-2"><Trophy size={18} style={{ color }} /><h3 className="text-base font-medium text-gray-800">Mode quiz</h3></div>
        <SettingToggle label="Activer le quiz (points et bonnes réponses)" value={!!s.quizMode} onChange={v => onUpdate({ quizMode: v })} color={color} />
        {s.quizMode && <SettingToggle label="Afficher le score immédiatement au répondant" value={s.showResultImmediately ?? true} onChange={v => onUpdate({ showResultImmediately: v })} color={color} />}
      </div>

      {/* Réponses */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <h3 className="text-base font-medium text-gray-800">Réponses</h3>
        <SettingToggle label="Collecter les adresses e-mail" value={s.collectEmail} onChange={v => onUpdate({ collectEmail: v })} color={color} />
        <SettingToggle label="Limiter à une réponse par personne" value={s.limitToOneResponse} onChange={v => onUpdate({ limitToOneResponse: v })} color={color} />
        <SettingToggle label="Accepter les réponses" value={s.acceptingResponses} onChange={v => onUpdate({ acceptingResponses: v })} color={color} />

        <div className="pt-2">
          <label className="text-sm font-medium text-gray-700 block mb-1">Message de confirmation</label>
          <textarea defaultValue={s.confirmationMessage} onBlur={e => onUpdate({ confirmationMessage: e.target.value })} rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:border-blue-500 outline-none resize-none" />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Nombre maximum de réponses</label>
          <input type="number" defaultValue={s.maxResponses ?? ''} onBlur={e => onUpdate({ maxResponses: e.target.value ? parseInt(e.target.value) : null })}
            placeholder="Illimité" className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 w-40 focus:border-blue-500 outline-none" />
        </div>
        <DatePicker label="Date de clôture" mode="datetime"
          value={s.closeDate ? new Date(s.closeDate).toISOString().slice(0, 16) : null}
          onChange={v => onUpdate({ closeDate: v ? new Date(v).toISOString() : null })} clearable />
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">URL Webhook (notification par réponse)</label>
          <input type="url" defaultValue={s.webhookUrl ?? ''} onBlur={e => onUpdate({ webhookUrl: e.target.value || null })}
            placeholder="https://example.com/webhook" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:border-blue-500 outline-none" />
        </div>
      </div>
    </div>
  )
}

function SettingToggle({ label, value, onChange, color }: { label: string; value: boolean; onChange: (v: boolean) => void; color: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-700">{label}</span>
      <button onClick={() => onChange(!value)} style={value ? { color } : { color: '#9ca3af' }}>
        {value ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
      </button>
    </div>
  )
}
