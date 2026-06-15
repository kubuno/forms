import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Eye, Send, Plus, Trash2, Copy,
  GripVertical, ChevronDown, ToggleLeft, ToggleRight,
  Minus, AlignLeft, CircleDot, Sliders, Star,
  Calendar, Clock, Upload, Grid3X3, ArrowLeft,
  BarChart2, ClipboardList,
} from 'lucide-react'
import { formsApi, type Form, type Question, type QuestionType } from './api'
import { DatePicker } from '@ui'

// ── Couleurs prédéfinies ──────────────────────────────────────────────────────

const FORM_COLORS = [
  '#db4437', '#e91e63', '#9c27b0', '#673ab7',
  '#3f51b5', '#1a73e8', '#03a9f4', '#00bcd4',
  '#009688', '#4caf50', '#8bc34a', '#cddc39',
  '#ffeb3b', '#ffc107', '#ff9800', '#795548',
  '#607d8b', '#9e9e9e',
]

// ── Types de questions ────────────────────────────────────────────────────────

const QUESTION_TYPES: Array<{ value: QuestionType; label: string }> = [
  { value: 'short_text',      label: 'Réponse courte' },
  { value: 'long_text',       label: 'Paragraphe' },
  { value: 'multiple_choice', label: 'Choix multiples' },
  { value: 'checkbox',        label: 'Cases à cocher' },
  { value: 'dropdown',        label: 'Liste déroulante' },
  { value: 'linear_scale',    label: 'Échelle linéaire' },
  { value: 'rating',          label: 'Étoiles' },
  { value: 'grid_radio',      label: 'Grille choix unique' },
  { value: 'grid_checkbox',   label: 'Grille cases' },
  { value: 'date',            label: 'Date' },
  { value: 'time',            label: 'Heure' },
  { value: 'file_upload',     label: 'Téléversement' },
  { value: 'section',         label: 'Section' },
]

// ── Page éditeur ──────────────────────────────────────────────────────────────

export default function FormEditorPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const [activeTab, setActiveTab]           = useState<'questions' | 'responses' | 'settings'>('questions')
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null)
  const [showThemePicker, setShowThemePicker]   = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['form', id],
    queryFn:  () => formsApi.get(id!).then(r => r.data),
    enabled:  !!id,
  })

  const updateFormMut = useMutation({
    mutationFn: (patch: Parameters<typeof formsApi.update>[1]) =>
      formsApi.update(id!, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['form', id] }),
  })

  const createQuestionMut = useMutation({
    mutationFn: (type: QuestionType) => formsApi.createQuestion(id!, { question_type: type }),
    onSuccess:  (r) => {
      qc.invalidateQueries({ queryKey: ['form', id] })
      setActiveQuestionId(r.data.question.id)
    },
  })

  const updateQuestionMut = useMutation({
    mutationFn: ({ qid, patch }: { qid: string; patch: Partial<Question> }) =>
      formsApi.updateQuestion(id!, qid, patch),
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

  const form      = data?.form
  const questions = data?.questions ?? []
  const color     = (form?.theme as { primaryColor?: string })?.primaryColor ?? '#673ab7'

  const debounceUpdate = useCallback(
    (patch: Parameters<typeof formsApi.update>[1]) => updateFormMut.mutate(patch),
    [updateFormMut]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-text-tertiary">Chargement du formulaire…</p>
      </div>
    )
  }

  if (!form) return null

  return (
    <div className="min-h-full flex flex-col" style={{ background: '#f0ebf8', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-4 h-14">
          {/* Gauche */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/forms')}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
            >
              <ArrowLeft size={18} />
            </button>
            <ClipboardList size={28} style={{ color }} />
            <input
              defaultValue={form.title}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== form.title) debounceUpdate({ title: v })
              }}
              className="text-gray-800 font-medium bg-transparent border-0 outline-none
                         border-b border-transparent hover:border-gray-400
                         focus:border-blue-500 text-base min-w-32 max-w-64"
              placeholder="Titre du formulaire"
            />
          </div>

          {/* Centre : onglets */}
          <div className="flex items-center gap-1">
            {(['questions', 'responses', 'settings'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
                  activeTab === tab
                    ? 'text-white font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                style={activeTab === tab ? { backgroundColor: color } : {}}
              >
                {tab === 'questions' && 'Questions'}
                {tab === 'responses' && `Réponses${form.response_count > 0 ? ` (${form.response_count})` : ''}`}
                {tab === 'settings'  && 'Paramètres'}
              </button>
            ))}
          </div>

          {/* Droite */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowThemePicker(v => !v)}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
              title="Thème"
            >
              <div className="w-4 h-4 rounded-full border-2 border-white shadow" style={{ backgroundColor: color }} />
            </button>
            <a
              href={`/forms/public/${form.public_token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
              title="Aperçu"
            >
              <Eye size={18} />
            </a>
            <button
              onClick={() => formsApi.publish(id!, !form.published_at)}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white rounded-full transition-colors"
              style={{ backgroundColor: color }}
            >
              <Send size={14} />
              {form.published_at ? 'Publié' : 'Publier'}
            </button>
          </div>
        </div>

        {/* Theme picker */}
        {showThemePicker && (
          <div className="absolute top-14 right-4 z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-4 w-72">
            <p className="text-sm font-medium text-gray-800 mb-3">Couleur du formulaire</p>
            <div className="grid grid-cols-9 gap-1.5 mb-4">
              {FORM_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => {
                    updateFormMut.mutate({ theme: { ...form.theme as object, primaryColor: c, headerColor: c } as Parameters<typeof formsApi.update>[1]['theme'] })
                    setShowThemePicker(false)
                  }}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110 border-2"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? 'white' : 'transparent',
                    outline: color === c ? `2px solid ${c}` : 'none',
                    outlineOffset: '2px',
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Contenu */}
      <div className="flex-1 max-w-3xl mx-auto w-full py-6 px-4 relative">
        {activeTab === 'questions' && (
          <>
            {/* En-tête du formulaire */}
            <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm mb-4">
              <div className="h-10 w-full" style={{ backgroundColor: color }} />
              <div className="px-6 py-5 border-t-4" style={{ borderColor: color }}>
                <input
                  defaultValue={form.title}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v && v !== form.title) debounceUpdate({ title: v })
                  }}
                  placeholder="Titre du formulaire"
                  className="w-full text-gray-800 text-2xl font-normal bg-transparent border-0
                             outline-none border-b border-transparent hover:border-gray-400
                             focus:border-blue-500 pb-1 mb-4 placeholder-gray-400"
                />
                <input
                  defaultValue={form.description ?? ''}
                  onBlur={(e) => debounceUpdate({ description: e.target.value || null })}
                  placeholder="Description du formulaire"
                  className="w-full text-gray-600 text-sm bg-transparent border-0 outline-none
                             border-b border-transparent hover:border-gray-400 focus:border-blue-500
                             placeholder-gray-400"
                />
              </div>
            </div>

            {/* Questions */}
            <div className="space-y-3">
              {questions.map(q => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  isActive={activeQuestionId === q.id}
                  primaryColor={color}
                  onClick={() => setActiveQuestionId(activeQuestionId === q.id ? null : q.id)}
                  onUpdate={(patch) => updateQuestionMut.mutate({ qid: q.id, patch })}
                  onDelete={() => deleteQuestionMut.mutate(q.id)}
                  onDuplicate={() => duplicateQuestionMut.mutate(q.id)}
                />
              ))}
            </div>

            {/* Bouton ajouter une question */}
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => createQuestionMut.mutate('short_text')}
                className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-full
                           bg-white border border-gray-300 text-gray-700
                           hover:border-gray-400 hover:shadow-sm transition-all"
              >
                <Plus size={16} />
                Ajouter une question
              </button>
            </div>

            {/* Sidebar flottante d'ajout */}
            <div className="fixed right-8 top-1/2 -translate-y-1/2 flex flex-col bg-white rounded-xl shadow-lg border border-gray-200 z-10">
              {[
                { icon: Plus,       label: 'Question',  type: 'short_text' as QuestionType },
                { icon: AlignLeft,  label: 'Texte',     type: 'long_text' as QuestionType },
                { icon: CircleDot,  label: 'Choix',     type: 'multiple_choice' as QuestionType },
                { icon: Sliders,    label: 'Échelle',   type: 'linear_scale' as QuestionType },
                { icon: Minus,      label: 'Section',   type: 'section' as QuestionType },
              ].map(({ icon: Icon, label, type }) => (
                <button
                  key={type}
                  onClick={() => createQuestionMut.mutate(type)}
                  title={label}
                  className="w-11 h-11 flex items-center justify-center text-gray-600
                             hover:bg-gray-50 transition-colors first:rounded-t-xl last:rounded-b-xl"
                >
                  <Icon size={18} />
                </button>
              ))}
            </div>
          </>
        )}

        {activeTab === 'responses' && (
          <ResponsesTab formId={id!} form={form} color={color} />
        )}

        {activeTab === 'settings' && (
          <SettingsTab form={form} color={color} onUpdate={(patch) => updateFormMut.mutate({ settings: patch as Parameters<typeof formsApi.update>[1]['settings'] })} />
        )}
      </div>
    </div>
  )
}

// ── Carte de question ─────────────────────────────────────────────────────────

function QuestionCard({ question, isActive, primaryColor, onClick, onUpdate, onDelete, onDuplicate }: {
  question:     Question
  isActive:     boolean
  primaryColor: string
  onClick:      () => void
  onUpdate:     (patch: Partial<Question>) => void
  onDelete:     () => void
  onDuplicate:  () => void
}) {
  const [showTypeMenu, setShowTypeMenu] = useState(false)

  return (
    <div
      className={`rounded-xl bg-white border shadow-sm transition-all ${
        isActive ? 'shadow-md border-gray-300' : 'border-gray-200 hover:shadow-md'
      }`}
      style={isActive ? { borderLeft: `6px solid ${primaryColor}` } : {}}
      onClick={onClick}
    >
      <div className="p-6">
        <div className="flex items-start gap-3 mb-4">
          {/* Titre */}
          <div className="flex-1">
            {isActive ? (
              <input
                defaultValue={question.title}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v) onUpdate({ title: v })
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder="Question sans titre"
                className="w-full text-gray-800 text-base bg-gray-50 border-0
                           border-b border-gray-400 focus:border-blue-600 outline-none px-2 py-1 rounded-t"
              />
            ) : (
              <div className="text-base text-gray-800">
                {question.title || <span className="text-gray-400">Question sans titre</span>}
                {question.required && <span className="text-red-500 ml-1">*</span>}
              </div>
            )}
          </div>

          {/* Sélecteur de type */}
          {isActive && (
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setShowTypeMenu(v => !v)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300
                           rounded-lg hover:border-gray-400 transition-colors text-gray-700"
              >
                {QUESTION_TYPES.find(t => t.value === question.question_type)?.label ?? question.question_type}
                <ChevronDown size={14} />
              </button>
              {showTypeMenu && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1 max-h-72 overflow-y-auto">
                  {QUESTION_TYPES.map(t => (
                    <button
                      key={t.value}
                      onClick={() => { onUpdate({ question_type: t.value }); setShowTypeMenu(false) }}
                      className={`flex items-center w-full px-4 py-2 text-sm transition-colors ${
                        question.question_type === t.value
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Aperçu du type de question */}
        <QuestionPreview question={question} />
      </div>

      {/* Barre d'actions */}
      {isActive && (
        <div
          className="flex items-center justify-between px-6 py-3 border-t border-gray-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1">
            <button onClick={onDuplicate} className="p-1.5 rounded text-gray-500 hover:bg-gray-100" title="Dupliquer">
              <Copy size={16} />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded text-gray-500 hover:text-red-500 hover:bg-red-50" title="Supprimer">
              <Trash2 size={16} />
            </button>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <GripVertical size={16} className="text-gray-400 cursor-grab" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Requis</span>
            <button
              onClick={() => onUpdate({ required: !question.required })}
              className="text-gray-500 transition-colors"
              style={question.required ? { color: primaryColor } : {}}
            >
              {question.required ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function QuestionPreview({ question }: { question: Question }) {
  const opts = (question.options as { options?: Array<{ id: string; label: string }> })?.options ?? []

  switch (question.question_type) {
    case 'short_text':
      return <div className="h-8 border-b border-gray-300 text-sm text-gray-400 flex items-end pb-1">Texte de réponse courte</div>
    case 'long_text':
      return <div className="h-16 border-b border-gray-300 text-sm text-gray-400 flex items-end pb-1">Texte de réponse longue</div>
    case 'multiple_choice':
    case 'checkbox':
    case 'dropdown':
      return (
        <div className="space-y-2">
          {opts.length > 0 ? opts.map(o => (
            <div key={o.id} className="flex items-center gap-2 text-sm text-gray-600">
              <div className={`w-4 h-4 rounded-full border-2 border-gray-400 ${question.question_type === 'checkbox' ? 'rounded' : ''}`} />
              {o.label}
            </div>
          )) : (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
              Option 1
            </div>
          )}
        </div>
      )
    case 'linear_scale':
      return (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>1 — Pas du tout</span>
          <div className="flex gap-2">
            {[1,2,3,4,5].map(n => (
              <div key={n} className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center text-xs text-gray-600">{n}</div>
            ))}
          </div>
          <span>5 — Tout à fait</span>
        </div>
      )
    case 'rating':
      return (
        <div className="flex gap-1">
          {[1,2,3,4,5].map(n => <Star key={n} size={24} className="text-gray-300" />)}
        </div>
      )
    case 'date':
      return <div className="flex items-center gap-2 text-sm text-gray-400"><Calendar size={16} /> JJ/MM/AAAA</div>
    case 'time':
      return <div className="flex items-center gap-2 text-sm text-gray-400"><Clock size={16} /> HH:MM</div>
    case 'file_upload':
      return (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 flex items-center justify-center text-sm text-gray-400">
          <Upload size={16} className="mr-2" /> Déposer un fichier
        </div>
      )
    case 'grid_radio':
    case 'grid_checkbox':
      return <div className="flex items-center gap-2 text-sm text-gray-400"><Grid3X3 size={16} /> Grille</div>
    case 'section':
      return <div className="h-px bg-gray-200 my-2" />
    default:
      return null
  }
}

// ── Onglet Réponses ───────────────────────────────────────────────────────────

function ResponsesTab({ formId, form, color }: { formId: string; form: Form; color: string }) {
  const [view, setView] = useState<'summary' | 'individual'>('summary')

  const { data: analyticsData } = useQuery({
    queryKey: ['forms-analytics', formId],
    queryFn:  () => formsApi.analytics(formId).then(r => r.data),
  })

  const { data: statsData } = useQuery({
    queryKey: ['forms-stats', formId],
    queryFn:  () => formsApi.questionStats(formId).then(r => r.data.stats),
    enabled:  view === 'summary',
  })

  return (
    <div className="space-y-4">
      {/* Stats globales */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="text-3xl font-light text-gray-800 mb-1">{analyticsData?.total_responses ?? form.response_count}</div>
        <div className="text-sm text-gray-500">réponse{(analyticsData?.total_responses ?? form.response_count) !== 1 ? 's' : ''}</div>
        {analyticsData?.avg_fill_duration_secs && (
          <div className="text-xs text-gray-400 mt-2">
            Durée moyenne : {Math.round(analyticsData.avg_fill_duration_secs)}s
          </div>
        )}
      </div>

      {/* Switcher vue */}
      <div className="flex gap-2">
        {(['summary', 'individual'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${
              view === v ? 'text-white border-transparent' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
            style={view === v ? { backgroundColor: color, borderColor: color } : {}}
          >
            {v === 'summary' ? 'Résumé' : 'Individuel'}
          </button>
        ))}
        <a
          href={formsApi.exportCsvUrl(formId)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto px-4 py-1.5 text-sm rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
        >
          <BarChart2 size={14} />
          Export CSV
        </a>
      </div>

      {view === 'summary' && statsData && statsData.map(stat => (
        <div key={stat.question_id} className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-base text-gray-800 mb-1">{stat.title}</div>
          <div className="text-sm text-gray-500 mb-4">{stat.total_answers} réponse{stat.total_answers !== 1 ? 's' : ''}</div>

          {stat.stat_type === 'distribution' && stat.distribution && (
            <div className="space-y-2">
              {stat.distribution.map(d => (
                <div key={d.option_id}>
                  <div className="flex justify-between text-sm text-gray-700 mb-1">
                    <span>{d.label}</span>
                    <span>{d.percentage}% ({d.count})</span>
                  </div>
                  <div className="h-5 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-full rounded transition-all"
                      style={{ width: `${d.percentage}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {stat.stat_type === 'scale' && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Moyenne</span>
                <span className="font-medium text-gray-800">{stat.mean?.toFixed(1)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Médiane</span>
                <span className="font-medium text-gray-800">{stat.median}</span>
              </div>
            </div>
          )}

          {stat.stat_type === 'text' && stat.texts && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {stat.texts.map((t, i) => (
                <div key={i} className="text-sm text-gray-700 border-b border-gray-100 pb-2">{t}</div>
              ))}
            </div>
          )}
        </div>
      ))}

      {view === 'individual' && <IndividualResponseView formId={formId} />}
    </div>
  )
}

function IndividualResponseView({ formId }: { formId: string }) {
  const [index, setIndex] = useState(0)
  const { data: totalData } = useQuery({
    queryKey: ['forms-responses-total', formId],
    queryFn:  () => formsApi.listResponses(formId, { limit: 1 }).then(r => r.data.total),
  })
  const total = totalData ?? 0

  const { data } = useQuery({
    queryKey: ['forms-response-individual', formId, index],
    queryFn:  () => formsApi.listResponses(formId, { limit: 1, offset: index }).then(async r => {
      if (r.data.responses[0]) {
        const resp = await formsApi.getResponse(formId, r.data.responses[0].id)
        return resp.data
      }
      return null
    }),
    enabled: total > 0,
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-600">{index + 1} / {total}</span>
        <div className="flex gap-2">
          <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50">
            ← Précédent
          </button>
          <button onClick={() => setIndex(i => Math.min(total - 1, i + 1))} disabled={index >= total - 1}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50">
            Suivant →
          </button>
        </div>
      </div>

      {data && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-xs text-gray-400 mb-4">
            Soumis le {new Date(data.response.submitted_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {data.response.respondent_email && ` · ${data.response.respondent_email}`}
          </div>
          <div className="space-y-4">
            {data.answers.map(a => (
              <div key={a.id}>
                <div className="text-xs text-gray-500 mb-1">Q: {a.question_id}</div>
                <div className="text-sm text-gray-800">
                  {typeof a.value === 'string' ? a.value :
                   Array.isArray(a.value) ? a.value.join(', ') :
                   JSON.stringify(a.value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Onglet Paramètres ─────────────────────────────────────────────────────────

function SettingsTab({ form, color, onUpdate }: { form: Form; color: string; onUpdate: (s: Partial<Form['settings']>) => void }) {
  const s = form.settings

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
      <h3 className="text-base font-medium text-gray-800">Paramètres du formulaire</h3>

      {/* Réponses */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-3">Réponses</h4>
        <div className="space-y-3">
          <SettingToggle label="Collecter les adresses email" value={s.collectEmail}
            onChange={v => onUpdate({ collectEmail: v })} color={color} />
          <SettingToggle label="Limiter à une réponse par personne" value={s.limitToOneResponse}
            onChange={v => onUpdate({ limitToOneResponse: v })} color={color} />
          <SettingToggle label="Permettre la modification après envoi" value={s.allowEditAfterSubmit}
            onChange={v => onUpdate({ allowEditAfterSubmit: v })} color={color} />
          <SettingToggle label="Afficher la barre de progression" value={s.showProgressBar}
            onChange={v => onUpdate({ showProgressBar: v })} color={color} />
          <SettingToggle label="Accepter les réponses" value={s.acceptingResponses}
            onChange={v => onUpdate({ acceptingResponses: v })} color={color} />
        </div>
      </div>

      {/* Message de confirmation */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">Message de confirmation</label>
        <textarea
          defaultValue={s.confirmationMessage}
          onBlur={(e) => onUpdate({ confirmationMessage: e.target.value })}
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700
                     focus:border-blue-500 focus:outline-none resize-none"
        />
      </div>

      {/* Limite de réponses */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">Nombre maximum de réponses</label>
        <input
          type="number"
          defaultValue={s.maxResponses ?? ''}
          onBlur={(e) => onUpdate({ maxResponses: e.target.value ? parseInt(e.target.value) : null })}
          placeholder="Illimité"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 w-40
                     focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Date de clôture */}
      <div>
        <DatePicker
          label="Date de clôture"
          mode="datetime"
          value={s.closeDate ? new Date(s.closeDate).toISOString().slice(0, 16) : null}
          onChange={v => onUpdate({ closeDate: v ? new Date(v).toISOString() : null })}
          clearable
        />
      </div>

      {/* Webhook */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">URL Webhook (notification par réponse)</label>
        <input
          type="url"
          defaultValue={s.webhookUrl ?? ''}
          onBlur={(e) => onUpdate({ webhookUrl: e.target.value || null })}
          placeholder="https://example.com/webhook"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700
                     focus:border-blue-500 focus:outline-none"
        />
      </div>
    </div>
  )
}

function SettingToggle({ label, value, onChange, color }: {
  label:    string
  value:    boolean
  onChange: (v: boolean) => void
  color:    string
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-700">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className="transition-colors"
        style={value ? { color } : { color: '#9ca3af' }}
      >
        {value ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
      </button>
    </div>
  )
}
