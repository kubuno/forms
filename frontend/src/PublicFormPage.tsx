import { useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Star, Upload, CheckSquare, ChevronDown } from 'lucide-react'
import { DatePicker, Radio, Checkbox } from '@ui'
import { publicFormsApi, type AnswerInput } from './api'

interface PublicQuestion {
  id:            string
  question_type: string
  title:         string
  description:   string | null
  required:      boolean
  options:       Record<string, unknown>
}

interface PublicFormData {
  id:          string
  title:       string
  description: string | null
  theme: {
    primaryColor: string
    headerColor:  string
    fontFamily:   string
  }
  settings: {
    collectEmail:        boolean
    showProgressBar:     boolean
    confirmationMessage: string
  }
  questions: PublicQuestion[]
}

export default function PublicFormPage() {
  const { token } = useParams<{ token: string }>()

  const { data: statusData } = useQuery({
    queryKey: ['form-status', token],
    queryFn:  () => publicFormsApi.status(token!).then(r => r.data),
    enabled:  !!token,
  })

  const { data: formData, isLoading } = useQuery({
    queryKey: ['public-form', token],
    queryFn:  () => publicFormsApi.getForm(token!).then(r => r.data.form as PublicFormData),
    enabled:  !!token && statusData?.status === 'open',
  })

  const [answers, setAnswers]       = useState<Record<string, unknown>>({})
  const [submitted, setSubmitted]   = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const startTimeRef = useRef(Date.now())

  const submitMut = useMutation({
    mutationFn: (data: { answers: AnswerInput[] }) =>
      publicFormsApi.submit(token!, {
        ...data,
        fill_duration_secs: Math.round((Date.now() - startTimeRef.current) / 1000),
      }),
    onSuccess: (r) => {
      setConfirmation(r.data.confirmation)
      setSubmitted(true)
    },
  })

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500 text-sm">Chargement du formulaire…</p>
      </div>
    )
  }

  if (statusData?.status === 'closed') {
    return <StatusScreen message="Ce formulaire n'accepte plus de réponses." />
  }
  if (statusData?.status === 'expired') {
    return <StatusScreen message="Ce formulaire a expiré." />
  }
  if (statusData?.status === 'full') {
    return <StatusScreen message="Ce formulaire a atteint son nombre maximum de réponses." />
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f0ebf8' }}>
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md w-full mx-4 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckSquare size={24} className="text-green-600" />
          </div>
          <h2 className="text-lg font-medium text-gray-800 mb-2">Réponse enregistrée</h2>
          <p className="text-sm text-gray-600">{confirmation}</p>
          <button
            onClick={() => {
              setAnswers({})
              setSubmitted(false)
              startTimeRef.current = Date.now()
            }}
            className="mt-6 text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Envoyer une autre réponse
          </button>
        </div>
      </div>
    )
  }

  if (!formData) return null

  const color = formData.theme.primaryColor ?? '#673ab7'
  const questions = formData.questions ?? []

  const handleSubmit = () => {
    const answersList: AnswerInput[] = Object.entries(answers).map(([question_id, value]) => ({
      question_id,
      value,
    }))
    submitMut.mutate({ answers: answersList })
  }

  return (
    <div
      className="min-h-screen py-8 px-4"
      style={{ background: '#f0ebf8', fontFamily: formData.theme.fontFamily }}
    >
      <div className="max-w-2xl mx-auto space-y-4">
        {/* En-tête */}
        <div className="rounded-xl overflow-hidden shadow-sm">
          <div className="h-10 w-full" style={{ borderTop: `10px solid ${color}`, background: color }} />
          <div className="bg-white px-6 py-5 border-t-4" style={{ borderColor: color }}>
            <h1 className="text-2xl text-gray-800 mb-2">{formData.title}</h1>
            {formData.description && <p className="text-sm text-gray-600">{formData.description}</p>}
            {formData.settings.collectEmail && (
              <p className="mt-3 text-xs text-gray-500">* Votre adresse email sera collectée.</p>
            )}
          </div>
        </div>

        {/* Questions */}
        {questions
          .filter(q => !['image', 'video'].includes(q.question_type))
          .map(q => (
            <div key={q.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="text-base text-gray-800 mb-1">
                {q.title}
                {q.required && <span className="text-red-500 ml-1">*</span>}
              </div>
              {q.description && <p className="text-sm text-gray-500 mb-3">{q.description}</p>}
              <QuestionInput
                question={q}
                value={answers[q.id]}
                onChange={(v) => setAnswers(prev => ({ ...prev, [q.id]: v }))}
                primaryColor={color}
              />
            </div>
          ))}

        {/* Bouton envoyer */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleSubmit}
            disabled={submitMut.isPending}
            className="px-8 py-3 rounded-lg text-sm text-white font-medium transition-opacity disabled:opacity-50"
            style={{ backgroundColor: color }}
          >
            {submitMut.isPending ? 'Envoi…' : 'Envoyer'}
          </button>
          <button
            onClick={() => setAnswers({})}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Effacer le formulaire
          </button>
        </div>

        {submitMut.isError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            Une erreur s'est produite. Veuillez réessayer.
          </div>
        )}

        <p className="text-center text-xs text-gray-400 pt-4">
          Propulsé par Kubuno Forms — vos données restent sur votre serveur
        </p>
      </div>
    </div>
  )
}

function QuestionInput({ question, value, onChange, primaryColor }: {
  question:     PublicQuestion
  value:        unknown
  onChange:     (v: unknown) => void
  primaryColor: string
}) {
  const opts = (question.options as { options?: Array<{ id: string; label: string }> })?.options ?? []
  const scaleOpts = question.options as { min?: number; max?: number; minLabel?: string; maxLabel?: string }

  switch (question.question_type) {
    case 'short_text':
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border-b border-gray-300 focus:border-current outline-none py-1 text-sm text-gray-700 bg-transparent"
          style={{ '--tw-border-opacity': '1' } as React.CSSProperties}
          placeholder="Votre réponse"
        />
      )
    case 'long_text':
      return (
        <textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="w-full border-b border-gray-300 outline-none py-1 text-sm text-gray-700 bg-transparent resize-none"
          placeholder="Votre réponse"
        />
      )
    case 'multiple_choice':
      return (
        <div className="space-y-2">
          {opts.map(o => (
            <Radio
              key={o.id}
              checked={value === o.id}
              onChange={() => onChange(o.id)}
              color={primaryColor}
              label={o.label}
              className="items-center"
              labelClassName="text-sm text-gray-700"
            />
          ))}
        </div>
      )
    case 'checkbox':
      return (
        <div className="space-y-2">
          {opts.map(o => {
            const checked = Array.isArray(value) && (value as string[]).includes(o.id)
            return (
              <Checkbox
                key={o.id}
                checked={checked}
                onChange={(isChecked) => {
                  const cur = Array.isArray(value) ? (value as string[]) : []
                  onChange(isChecked ? [...cur, o.id] : cur.filter(id => id !== o.id))
                }}
                color={primaryColor}
                label={o.label}
                className="items-center"
                labelClassName="text-sm text-gray-700"
              />
            )
          })}
        </div>
      )
    case 'dropdown':
      return (
        <div className="relative">
          <select
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700
                       focus:outline-none appearance-none bg-white pr-8"
          >
            <option value="">Choisir…</option>
            {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
      )
    case 'linear_scale': {
      const min = scaleOpts.min ?? 1
      const max = scaleOpts.max ?? 5
      const range = Array.from({ length: max - min + 1 }, (_, i) => min + i)
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            {scaleOpts.minLabel && <span className="text-xs text-gray-500">{scaleOpts.minLabel}</span>}
            <div className="flex gap-2 flex-wrap">
              {range.map(n => (
                <button
                  key={n}
                  onClick={() => onChange(n)}
                  className="w-9 h-9 rounded-full border-2 text-sm font-medium transition-colors"
                  style={{
                    borderColor: value === n ? primaryColor : '#d1d5db',
                    backgroundColor: value === n ? primaryColor : 'transparent',
                    color: value === n ? 'white' : '#374151',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            {scaleOpts.maxLabel && <span className="text-xs text-gray-500">{scaleOpts.maxLabel}</span>}
          </div>
        </div>
      )
    }
    case 'rating': {
      const max = (question.options as { max?: number })?.max ?? 5
      return (
        <div className="flex gap-2">
          {Array.from({ length: max }, (_, i) => i + 1).map(n => (
            <button key={n} onClick={() => onChange(n)}>
              <Star
                size={28}
                className="transition-colors"
                style={{
                  color: (value as number) >= n ? '#fbbf24' : '#d1d5db',
                  fill:  (value as number) >= n ? '#fbbf24' : 'none',
                }}
              />
            </button>
          ))}
        </div>
      )
    }
    case 'date':
      return (
        <DatePicker
          mode="date"
          value={(value as string) || null}
          onChange={v => onChange(v ?? '')}
        />
      )
    case 'time':
      return (
        <DatePicker
          mode="time"
          value={(value as string) || null}
          onChange={v => onChange(v ?? '')}
        />
      )
    case 'file_upload':
      return (
        <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center">
          <Upload size={24} className="mx-auto mb-2 text-gray-400" />
          <p className="text-sm text-gray-500">Glissez un fichier ici ou</p>
          <button className="mt-2 text-sm font-medium" style={{ color: primaryColor }}>
            Parcourir
          </button>
        </div>
      )
    case 'section':
      return <div className="h-px bg-gray-200" />
    default:
      return null
  }
}

function StatusScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md w-full mx-4 text-center">
        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckSquare size={24} className="text-gray-500" />
        </div>
        <p className="text-gray-700">{message}</p>
      </div>
    </div>
  )
}
