// Per-question configuration shown inside an active question card in the editor:
// choice options, scale settings, ranking, grids, content button labels, and
// (in quiz mode) points / correct answers / feedback.
import { useRef, useState } from 'react'
import { Plus, X, Check, Trophy, HardDrive, Clapperboard, Link2, Search, GripVertical, Image as ImageIcon } from 'lucide-react'
import { Dropdown, Button, Input, Spinner } from '@ui'
import { useQuery } from '@tanstack/react-query'
import { api, ModuleServiceRegistry, useModulesStore } from '@kubuno/sdk'
import { formsApi, type Question } from './api'
import { pickImageFile } from './imagePicker'
import { getMeta, genId } from './questionTypes'
import { readSource, providerName, type VideoKind, type VideoSource } from './videoSource'
import VideoBlock from './VideoBlock'

interface Opt { id: string; label: string; image?: string | null }

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

      {question.question_type === 'video' && (
        <VideoOptions source={readSource(o)} onPick={v => patchOptions({ video: v })} />
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

  // Drag-to-reorder within the option list. The handle is the only draggable
  // part: making the whole row draggable would fight text selection in the input.
  const dragId = useRef<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const drop = (targetId: string) => {
    const from = dragId.current
    dragId.current = null
    setOverId(null)
    if (!from || from === targetId) return
    const next = [...opts]
    const i = next.findIndex(o => o.id === from)
    const j = next.findIndex(o => o.id === targetId)
    if (i < 0 || j < 0) return
    const [moved] = next.splice(i, 1)
    next.splice(j, 0, moved)
    update(next)
  }

  return (
    <div className="space-y-2">
      {opts.map(op => {
        const isCorrect = correct.includes(op.id)
        return (
          <div key={op.id}
            className="group flex items-center gap-2 rounded"
            onDragOver={e => { e.preventDefault(); if (overId !== op.id) setOverId(op.id) }}
            onDragLeave={() => { if (overId === op.id) setOverId(null) }}
            onDrop={e => { e.preventDefault(); drop(op.id) }}
            style={overId === op.id && dragId.current && dragId.current !== op.id
              ? { boxShadow: `inset 0 2px 0 0 ${color}` } : undefined}>
            {/* Reorder handle — appears on hover, like the question handle. */}
            <span
              draggable
              onDragStart={() => { dragId.current = op.id }}
              onDragEnd={() => { dragId.current = null; setOverId(null) }}
              title="Déplacer cette option"
              className="shrink-0 cursor-grab active:cursor-grabbing text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
              <GripVertical size={15} />
            </span>
            <span className={`w-4 h-4 border-2 border-gray-300 shrink-0 ${isMulti ? 'rounded' : 'rounded-full'}`} />
            <input value={op.label} onChange={e => setLabel(op.id, e.target.value)}
              onFocus={e => { e.currentTarget.style.borderBottomColor = color }}
              onBlur={e => { e.currentTarget.style.borderBottomColor = '' }}
              className="flex-1 text-sm text-gray-700 border-b border-transparent hover:border-gray-300 outline-none py-1 bg-transparent" />
            <OptionImageButton
              formId={question.form_id}
              image={op.image ?? null}
              onChange={url => update(opts.map(o => o.id === op.id ? { ...o, image: url } : o))}
            />
            {canScore && (
              <button onClick={() => toggleCorrect(op.id)} title="Marquer comme bonne réponse"
                className="w-6 h-6 rounded-full flex items-center justify-center border transition-colors"
                style={{ borderColor: isCorrect ? '#16a34a' : '#d1d5db', backgroundColor: isCorrect ? '#16a34a' : 'transparent', color: isCorrect ? 'white' : '#9ca3af' }}>
                <Check size={13} />
              </button>
            )}
            <button onClick={() => remove(op.id)} title="Supprimer cette option" className="text-gray-400 hover:text-red-500"><X size={16} /></button>
          </div>
        )
      })}
      {opts.some(o => o.image) && (
        <div className="pl-9 space-y-2">
          {opts.filter(o => o.image).map(o => (
            <div key={o.id} className="relative inline-block mr-2">
              <img src={o.image as string} alt={o.label}
                className="max-h-28 rounded border border-gray-200" />
              <button onClick={() => update(opts.map(x => x.id === o.id ? { ...x, image: null } : x))}
                title="Retirer l'image de cette option"
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white shadow border border-gray-200
                           flex items-center justify-center text-gray-500 hover:text-red-500">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button onClick={add} className="flex items-center gap-1.5 text-sm" style={{ color }}>
        <Plus size={15} /> Ajouter une option
      </button>
    </div>
  )
}

/** Adds an illustration to an option: uploaded into the FORM's own storage, so
 *  anonymous respondents can load it (Drive/Media would answer them 401). */
function OptionImageButton({ formId, image, onChange }: {
  formId: string; image: string | null; onChange: (url: string | null) => void
}) {
  const [busy, setBusy] = useState(false)

  const pick = async () => {
    setBusy(true)
    try {
      const file = await pickImageFile(image ? "Remplacer l'image" : "Image de l'option")
      if (!file) return
      const r = await formsApi.uploadImage(formId, file)
      onChange(r.data.url)
    } finally { setBusy(false) }
  }

  return (
    <>
      <button type="button" disabled={busy}
        title={image ? "Remplacer l'image de l'option" : "Ajouter une image à l'option"}
        onClick={() => { void pick() }}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-gray-400
                   hover:text-gray-700 hover:bg-gray-100 disabled:opacity-40 transition-colors">
        <ImageIcon size={16} />
      </button>
    </>
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
          <Dropdown value={(o.icon as string) ?? 'star'} onChange={v => patchOptions({ icon: v })}
            options={[{ value: 'star', label: 'Étoile' }, { value: 'heart', label: 'Cœur' }]}
            height={34} fontSize={14} />
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

// ── Video source ──────────────────────────────────────────────────────────────

interface MediaItem { id: string; title: string }

/**
 * Source picker for a `video` question: a Drive file, a Media item (only when
 * that module is installed) or an external link. No cross-module import: Drive
 * comes from the core's ModuleServiceRegistry, Media from its HTTP API behind
 * the core proxy.
 */
function VideoOptions({ source, onPick }: {
  source: VideoSource | null
  onPick: (v: VideoSource) => void
}) {
  const activeModules  = useModulesStore(s => s.activeModules)
  const mediaAvailable = activeModules.some(m => m.module_id === 'media')
  const openFilePicker = ModuleServiceRegistry.get<(o?: object) => Promise<unknown>>('drive', 'openFilePicker')

  const [kind, setKind] = useState<VideoKind>(source?.kind ?? 'url')
  const [draftUrl, setDraftUrl] = useState(source?.url ?? '')

  const sources: Array<{ id: VideoKind; label: string; Icon: typeof Link2; enabled: boolean }> = [
    { id: 'drive', label: 'Drive',        Icon: HardDrive,    enabled: !!openFilePicker },
    { id: 'media', label: 'Media',        Icon: Clapperboard, enabled: mediaAvailable },
    { id: 'url',   label: 'Lien externe', Icon: Link2,        enabled: true },
  ]

  const pickFromDrive = async () => {
    if (!openFilePicker) return
    const picked = await openFilePicker({ accept: 'video/*', multiple: false }) as
      | { id: string; name?: string }
      | Array<{ id: string; name?: string }>
      | null
    const file = Array.isArray(picked) ? picked[0] : picked
    if (file?.id) onPick({ kind: 'drive', id: file.id, title: file.name })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        {sources.filter(s => s.enabled).map(s => (
          <Button key={s.id} size="sm" variant={kind === s.id ? 'primary' : 'ghost'}
            icon={<s.Icon size={14} />} onClick={() => setKind(s.id)}>
            {s.label}
          </Button>
        ))}
      </div>

      {kind === 'drive' && (
        <Button variant="secondary" size="sm" icon={<HardDrive size={14} />}
          onClick={() => { void pickFromDrive() }}>
          Choisir une vidéo dans Drive
        </Button>
      )}

      {kind === 'media' && <MediaPicker onPick={onPick} />}

      {kind === 'url' && (
        <div className="flex items-center gap-2 w-full">
          {/* `flex-1 min-w-0` on the wrapper AND `w-full` on the field: @ui Input
              renders its own wrapper, so a class on the field alone cannot make
              it stretch. */}
          <div className="flex-1 min-w-0">
            <Input
              value={draftUrl}
              onChange={e => setDraftUrl(e.target.value)}
              onBlur={() => onPick({ kind: 'url', url: draftUrl.trim() })}
              placeholder="https://… (YouTube, Dailymotion, Vimeo, PeerTube ou fichier .mp4)"
              className="w-full"
            />
          </div>
          {draftUrl.trim() && (
            <span className="text-xs text-text-tertiary whitespace-nowrap flex-shrink-0">
              {providerName(draftUrl.trim()) ?? 'Fichier direct'}
            </span>
          )}
        </div>
      )}

      {source && (
        <div className="pt-1">
          <VideoBlock options={{ video: source }} />
          {source.title && <p className="text-xs text-text-tertiary mt-1 truncate">{source.title}</p>}
        </div>
      )}
    </div>
  )
}

/** Searchable list of the Media module's movies, fetched through the core proxy. */
function MediaPicker({ onPick }: { onPick: (v: VideoSource) => void }) {
  const [q, setQ] = useState('')
  const { data, isLoading, isError } = useQuery({
    queryKey: ['forms-media-movies'],
    queryFn:  () => api.get<{ movies: MediaItem[] }>('/media/movies').then(r => r.data),
  })
  const movies = (data?.movies ?? []).filter(m =>
    !q.trim() || m.title.toLowerCase().includes(q.trim().toLowerCase()))

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-text-tertiary"><Spinner /> Chargement…</div>
  if (isError)   return <p className="text-sm text-text-tertiary">Impossible de contacter le module Media.</p>

  return (
    <div className="space-y-2">
      <Input value={q} onChange={e => setQ(e.target.value)} leftIcon={<Search size={14} />}
        placeholder="Rechercher une vidéo…" className="w-full" />
      <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {movies.length === 0
          ? <p className="px-3 py-3 text-sm text-text-tertiary">Aucune vidéo trouvée.</p>
          : movies.map(m => (
              <button key={m.id} onClick={() => onPick({ kind: 'media', id: m.id, title: m.title })}
                className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-surface-1">
                {m.title}
              </button>
            ))}
      </div>
    </div>
  )
}

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
