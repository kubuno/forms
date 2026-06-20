import { useState, useRef, useMemo, useEffect, useCallback, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { CheckCircle2, ChevronUp, ChevronDown, ArrowRight, Trophy } from 'lucide-react'
import { publicFormsApi, type AnswerInput, type PublicForm, type PublicQuestion, type QuizResult } from './api'
import QuestionFiller from './QuestionFiller'
import { computeHidden, resolveJump } from './logic'
import { isContentType } from './questionTypes'

// ── Page entrypoint ──────────────────────────────────────────────────────────

export default function PublicFormPage() {
  const { token } = useParams<{ token: string }>()

  const { data: statusData } = useQuery({
    queryKey: ['form-status', token],
    queryFn:  () => publicFormsApi.status(token!).then(r => r.data),
    enabled:  !!token,
  })

  const { data: formData, isLoading } = useQuery({
    queryKey: ['public-form', token],
    queryFn:  () => publicFormsApi.getForm(token!).then(r => r.data.form as PublicForm),
    enabled:  !!token && statusData?.status === 'open',
  })

  if (isLoading || (statusData?.status === 'open' && !formData)) {
    return <Centered><p className="text-gray-500 text-sm">Chargement du formulaire…</p></Centered>
  }
  if (statusData?.status === 'closed')  return <StatusScreen message="Ce formulaire n'accepte plus de réponses." />
  if (statusData?.status === 'expired') return <StatusScreen message="Ce formulaire a expiré." />
  if (statusData?.status === 'full')    return <StatusScreen message="Ce formulaire a atteint son nombre maximum de réponses." />
  if (!formData) return null

  const mode = formData.settings.displayMode ?? 'one_at_a_time'
  return mode === 'classic'
    ? <ClassicShell form={formData} token={token!} />
    : <OneAtATimeShell form={formData} token={token!} />
}

// ── Shared submission logic ──────────────────────────────────────────────────

function useSubmission(form: PublicForm, token: string) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [done, setDone] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null)
  const startTimeRef = useRef(Date.now())

  const mutation = useMutation({
    mutationFn: () => {
      const list: AnswerInput[] = Object.entries(answers)
        .filter(([, v]) => v != null && !(typeof v === 'string' && v === '') && !(Array.isArray(v) && v.length === 0))
        .map(([question_id, value]) => ({ question_id, value }))
      const email = form.settings.collectEmail ? (answers.__email as string | undefined) : undefined
      return publicFormsApi.submit(token, {
        answers: list,
        respondent_email: email,
        fill_duration_secs: Math.round((Date.now() - startTimeRef.current) / 1000),
      })
    },
    onSuccess: (r) => {
      setConfirmation(r.data.confirmation)
      setQuizResult(r.data.result)
      setDone(true)
    },
  })

  const reset = () => {
    setAnswers({})
    setDone(false)
    setQuizResult(null)
    startTimeRef.current = Date.now()
  }

  return { answers, setAnswers, done, confirmation, quizResult, mutation, reset, startTimeRef }
}

// ── One question at a time (Typeform-style) ──────────────────────────────────

function OneAtATimeShell({ form, token }: { form: PublicForm; token: string }) {
  const color = form.theme.primaryColor ?? '#673ab7'
  const { answers, setAnswers, done, confirmation, quizResult, mutation } = useSubmission(form, token)

  const welcome = form.questions.find(q => q.question_type === 'welcome_screen')
  const thankYou = form.questions.find(q => q.question_type === 'thank_you_screen')

  const [phase, setPhase] = useState<'welcome' | 'filling'>(welcome ? 'welcome' : 'filling')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const history = useRef<string[]>([])
  const [anim, setAnim] = useState<'in' | 'out-up' | 'out-down'>('in')

  // Visible input steps (respecting conditional logic + content-type exclusions).
  const steps = useMemo(() => {
    const hidden = computeHidden(form.questions, form.rules, answers)
    return form.questions.filter(q =>
      !hidden.has(q.id) &&
      q.question_type !== 'section' &&
      q.question_type !== 'welcome_screen' &&
      q.question_type !== 'thank_you_screen',
    )
  }, [form.questions, form.rules, answers])

  // Initialise / heal the current step pointer.
  useEffect(() => {
    if (phase !== 'filling') return
    if (currentId == null || !steps.some(s => s.id === currentId)) {
      setCurrentId(steps[0]?.id ?? null)
    }
  }, [phase, steps, currentId])

  const currentIdx = steps.findIndex(s => s.id === currentId)
  const current = currentIdx >= 0 ? steps[currentIdx] : undefined

  const setAnswer = (qid: string, v: unknown) => setAnswers(prev => ({ ...prev, [qid]: v }))

  const isAnswered = (q: PublicQuestion) => {
    const v = answers[q.id]
    return v != null && !(typeof v === 'string' && v.trim() === '') && !(Array.isArray(v) && v.length === 0)
  }

  const goNext = useCallback(() => {
    if (!current) { mutation.mutate(); return }
    if (current.required && !isContentType(current.question_type) && !isAnswered(current)) return

    const jump = resolveJump(current.id, form.rules, answers)
    if (jump?.kind === 'submit' || jump?.kind === 'thankyou') { animateOut('up'); mutation.mutate(); return }

    let nextId: string | null = null
    if (jump?.kind === 'goto') {
      // Jump to the target (or the first visible step at/after it).
      const targetPos = form.questions.findIndex(q => q.id === jump.targetId)
      nextId = steps.find(s => form.questions.findIndex(q => q.id === s.id) >= targetPos)?.id ?? null
    } else {
      nextId = steps[currentIdx + 1]?.id ?? null
    }

    if (nextId == null) { animateOut('up'); mutation.mutate(); return }
    history.current.push(current.id)
    transitionTo(nextId, 'up')
  }, [current, currentIdx, steps, answers, form.rules, form.questions, mutation])

  const goBack = () => {
    const prev = history.current.pop()
    if (prev) transitionTo(prev, 'down')
  }

  const transitionTo = (id: string, dir: 'up' | 'down') => {
    setAnim(dir === 'up' ? 'out-up' : 'out-down')
    setTimeout(() => { setCurrentId(id); setAnim('in') }, 180)
  }
  const animateOut = (dir: 'up' | 'down') => setAnim(dir === 'up' ? 'out-up' : 'out-down')

  // Keyboard: Enter advances (except inside a textarea where Enter inserts a newline).
  useEffect(() => {
    if (phase !== 'filling') return
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === 'Enter' && !e.shiftKey) {
        if (t && t.tagName === 'TEXTAREA') return
        e.preventDefault(); goNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, goNext])

  const bg = form.theme.backgroundColor || `${color}0d`

  if (done) return <DoneScreen color={color} confirmation={confirmation} quizResult={quizResult} thankYou={thankYou} bg={bg} />

  if (phase === 'welcome' && welcome) {
    return (
      <FullScreen bg={bg} font={form.theme.fontFamily}>
        <div className="max-w-xl w-full text-center animate-[fadeIn_.4s_ease]">
          <h1 className="text-3xl font-semibold text-gray-900 mb-4">{welcome.title}</h1>
          {welcome.description && <p className="text-lg text-gray-600 mb-8 whitespace-pre-wrap">{welcome.description}</p>}
          <button onClick={() => setPhase('filling')} className="inline-flex items-center gap-2 px-7 py-3 rounded-xl text-white text-base font-medium shadow-sm transition-transform hover:scale-105" style={{ backgroundColor: color }}>
            {(welcome.options?.buttonText as string) || 'Commencer'} <ArrowRight size={18} />
          </button>
          <p className="mt-4 text-xs text-gray-400">Appuyez sur Entrée ↵</p>
        </div>
      </FullScreen>
    )
  }

  const total = steps.length
  const progress = total ? Math.round(((currentIdx + 1) / total) * 100) : 0
  const animClass = anim === 'in' ? 'opacity-100 translate-y-0' : anim === 'out-up' ? 'opacity-0 -translate-y-6' : 'opacity-0 translate-y-6'

  return (
    <FullScreen bg={bg} font={form.theme.fontFamily}>
      {/* Progress bar */}
      {form.settings.showProgressBar !== false && (
        <div className="fixed top-0 left-0 right-0 h-1.5 bg-black/5 z-20 no-print">
          <div className="h-full transition-all duration-300" style={{ width: `${progress}%`, backgroundColor: color }} />
        </div>
      )}

      <div className="max-w-2xl w-full">
        <div className={`transition-all duration-200 ease-out ${animClass}`}>
          {current && (
            <div>
              <div className="flex items-start gap-2 mb-1">
                <span className="text-sm font-medium mt-1.5" style={{ color }}>{currentIdx + 1} <ArrowRight size={12} className="inline" /></span>
                <div>
                  <h2 className="text-2xl font-medium text-gray-900">
                    {current.title}
                    {current.required && <span className="text-red-400 ml-1">*</span>}
                  </h2>
                  {current.description && <p className="text-gray-500 mt-1 whitespace-pre-wrap">{current.description}</p>}
                </div>
              </div>

              {current.question_type === 'statement' ? (
                <div className="mt-6" />
              ) : (
                <div className="mt-6 ml-7">
                  {/* Optional email collection injected as a virtual first input */}
                  <QuestionFiller
                    question={current}
                    value={answers[current.id]}
                    onChange={(v) => setAnswer(current.id, v)}
                    primaryColor={color}
                    token={token}
                    large
                    autoFocus
                  />
                </div>
              )}

              <div className="mt-8 ml-7 flex items-center gap-3">
                <button onClick={goNext} disabled={mutation.isPending}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-white font-medium shadow-sm transition-transform hover:scale-105 disabled:opacity-50"
                  style={{ backgroundColor: color }}>
                  {currentIdx >= total - 1 ? (mutation.isPending ? 'Envoi…' : 'Envoyer') : 'OK'}
                  {currentIdx < total - 1 && <CheckCircle2 size={16} />}
                </button>
                <span className="text-xs text-gray-400">Entrée ↵</span>
              </div>
            </div>
          )}
        </div>

        {mutation.isError && (
          <div className="mt-6 ml-7 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            Une erreur s'est produite. Veuillez réessayer.
          </div>
        )}
      </div>

      {/* Up/Down navigation */}
      <div className="fixed bottom-5 right-5 flex flex-col rounded-lg overflow-hidden shadow-lg no-print">
        <button onClick={goBack} disabled={history.current.length === 0}
          className="w-9 h-9 flex items-center justify-center text-white disabled:opacity-40" style={{ backgroundColor: color }}>
          <ChevronUp size={18} />
        </button>
        <button onClick={goNext}
          className="w-9 h-9 flex items-center justify-center text-white border-t border-white/20" style={{ backgroundColor: color }}>
          <ChevronDown size={18} />
        </button>
      </div>

      <div className="fixed bottom-2 left-1/2 -translate-x-1/2"><PoweredBy /></div>
    </FullScreen>
  )
}

// ── Classic (scrolling) shell ────────────────────────────────────────────────

function ClassicShell({ form, token }: { form: PublicForm; token: string }) {
  const color = form.theme.primaryColor ?? '#673ab7'
  const { answers, setAnswers, done, confirmation, quizResult, mutation } = useSubmission(form, token)
  const [missing, setMissing] = useState<Set<string>>(new Set())

  const welcome = form.questions.find(q => q.question_type === 'welcome_screen')
  const thankYou = form.questions.find(q => q.question_type === 'thank_you_screen')

  const visible = useMemo(() => {
    const hidden = computeHidden(form.questions, form.rules, answers)
    return form.questions.filter(q =>
      !hidden.has(q.id) &&
      q.question_type !== 'welcome_screen' &&
      q.question_type !== 'thank_you_screen',
    )
  }, [form.questions, form.rules, answers])

  const setAnswer = (qid: string, v: unknown) => setAnswers(prev => ({ ...prev, [qid]: v }))

  const handleSubmit = () => {
    const miss = new Set<string>()
    for (const q of visible) {
      if (q.required && !isContentType(q.question_type)) {
        const v = answers[q.id]
        if (v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)) miss.add(q.id)
      }
    }
    setMissing(miss)
    if (miss.size === 0) mutation.mutate()
  }

  const bg = form.theme.backgroundColor || '#f3f0fb'
  if (done) return <DoneScreen color={color} confirmation={confirmation} quizResult={quizResult} thankYou={thankYou} bg={bg} />

  const inputCount = visible.filter(q => !isContentType(q.question_type)).length
  const answeredCount = visible.filter(q => !isContentType(q.question_type) && answers[q.id] != null && answers[q.id] !== '').length
  const progress = inputCount ? Math.round((answeredCount / inputCount) * 100) : 0

  return (
    <div className="min-h-screen py-8 px-4" style={{ background: bg, fontFamily: form.theme.fontFamily }}>
      {form.settings.showProgressBar !== false && (
        <div className="fixed top-0 left-0 right-0 h-1.5 bg-black/5 z-20 no-print">
          <div className="h-full transition-all" style={{ width: `${progress}%`, backgroundColor: color }} />
        </div>
      )}
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="rounded-xl overflow-hidden shadow-sm">
          <div className="h-2.5 w-full" style={{ background: color }} />
          <div className="bg-white px-6 py-5 border-t-4" style={{ borderColor: color }}>
            <h1 className="text-2xl text-gray-800 mb-2">{welcome?.title || form.title}</h1>
            {(welcome?.description || form.description) && (
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{welcome?.description || form.description}</p>
            )}
            {form.settings.collectEmail && (
              <div className="mt-4">
                <label className="text-sm text-gray-700 block mb-1">Adresse e-mail <span className="text-red-500">*</span></label>
                <input type="email" value={(answers.__email as string) ?? ''} onChange={e => setAnswer('__email', e.target.value)}
                  placeholder="nom@exemple.com" className="w-full border-b border-gray-300 outline-none py-1 text-sm text-gray-700 bg-transparent" />
              </div>
            )}
          </div>
        </div>

        {/* Questions */}
        {visible.map(q => {
          if (q.question_type === 'section') {
            return (
              <div key={q.id} className="pt-4">
                {q.title && <h2 className="text-lg font-medium text-gray-700 border-b border-gray-200 pb-2">{q.title}</h2>}
                {q.description && <p className="text-sm text-gray-500 mt-1">{q.description}</p>}
              </div>
            )
          }
          if (q.question_type === 'statement') {
            return (
              <div key={q.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <h3 className="text-base font-medium text-gray-800">{q.title}</h3>
                {q.description && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{q.description}</p>}
              </div>
            )
          }
          return (
            <div key={q.id} className={`bg-white rounded-xl border shadow-sm p-6 ${missing.has(q.id) ? 'border-red-300' : 'border-gray-200'}`}>
              <div className="text-base text-gray-800 mb-1">
                {q.title}{q.required && <span className="text-red-500 ml-1">*</span>}
              </div>
              {q.description && <p className="text-sm text-gray-500 mb-3 whitespace-pre-wrap">{q.description}</p>}
              <div className="mt-3">
                <QuestionFiller question={q} value={answers[q.id]} onChange={v => setAnswer(q.id, v)} primaryColor={color} token={token} />
              </div>
              {missing.has(q.id) && <p className="text-xs text-red-500 mt-2">Cette question est obligatoire.</p>}
            </div>
          )
        })}

        <div className="flex items-center justify-between pt-2 no-print">
          <button onClick={handleSubmit} disabled={mutation.isPending}
            className="px-8 py-3 rounded-lg text-sm text-white font-medium transition-opacity disabled:opacity-50" style={{ backgroundColor: color }}>
            {mutation.isPending ? 'Envoi…' : 'Envoyer'}
          </button>
          <button onClick={() => { setAnswers({}); setMissing(new Set()) }} className="text-sm text-gray-500 hover:text-gray-700">Effacer le formulaire</button>
        </div>

        {mutation.isError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">Une erreur s'est produite. Veuillez réessayer.</div>
        )}
        <PoweredBy />
      </div>
    </div>
  )
}

// ── Result / confirmation screens ────────────────────────────────────────────

function DoneScreen({ color, confirmation, quizResult, thankYou, bg }: {
  color: string; confirmation: string; quizResult: QuizResult | null; thankYou?: PublicQuestion; bg: string
}) {
  return (
    <FullScreen bg={bg}>
      <div className="max-w-md w-full text-center bg-white rounded-2xl border border-gray-200 shadow-sm p-8 animate-[fadeIn_.4s_ease]">
        {quizResult ? (
          <>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: `${color}1a` }}>
              <Trophy size={28} style={{ color }} />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Votre score</h2>
            <p className="text-4xl font-bold mb-2" style={{ color }}>{quizResult.score} / {quizResult.max_score}</p>
            <p className="text-sm text-gray-600 mb-4">{Math.round((quizResult.score / Math.max(1, quizResult.max_score)) * 100)} %</p>
          </>
        ) : (
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={28} className="text-green-600" />
          </div>
        )}
        <h3 className="text-lg font-medium text-gray-800 mb-1">{thankYou?.title || 'Merci !'}</h3>
        <p className="text-sm text-gray-600 whitespace-pre-wrap">{thankYou?.description || confirmation}</p>
        <PoweredBy />
      </div>
    </FullScreen>
  )
}

// ── Small shared pieces ──────────────────────────────────────────────────────

function FullScreen({ children, bg, font }: { children: ReactNode; bg: string; font?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-16" style={{ background: bg, fontFamily: font }}>
      {children}
    </div>
  )
}
function Centered({ children }: { children: ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center">{children}</div>
}
function PoweredBy() {
  return <p className="text-center text-xs text-gray-400 pt-6">Propulsé par Kubuno Forms — vos données restent sur votre serveur</p>
}
function StatusScreen({ message }: { message: string }) {
  return (
    <Centered>
      <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md w-full mx-4 text-center">
        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={24} className="text-gray-500" />
        </div>
        <p className="text-gray-700">{message}</p>
      </div>
    </Centered>
  )
}
