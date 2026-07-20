// Renders the answer input for any question type. Shared by the classic
// (scroll) and one-at-a-time (Typeform-style) public form shells.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Star, Heart, Upload, ChevronDown, Check, X, ArrowUp, ArrowDown, FileCheck2, Eraser } from 'lucide-react'
// Aliased: this file already has a local `Dropdown` (the answer control).
import { DatePicker, Dropdown as UiDropdown } from '@ui'
import VideoBlock from './VideoBlock'
import { publicFormsApi, type PublicQuestion, type UploadedFile } from './api'

interface Opt { id: string; label: string; image?: string | null }

interface Props {
  question:     PublicQuestion
  value:        unknown
  onChange:     (v: unknown) => void
  primaryColor: string
  token:        string
  /** Large immersive styling for one-at-a-time mode. */
  large?:       boolean
  autoFocus?:   boolean
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export default function QuestionFiller({ question, value, onChange, primaryColor, token, large, autoFocus }: Props) {
  const o = question.options as Record<string, unknown>
  const opts = (o?.options as Opt[]) ?? []

  switch (question.question_type) {
    case 'short_text':
    case 'email':
    case 'phone':
    case 'url':
      return <TextInput {...{ question, value, onChange, primaryColor, large, autoFocus }} />
    case 'number':
      return <TextInput {...{ question, value, onChange, primaryColor, large, autoFocus }} numeric />
    case 'long_text':
      return <LongText {...{ value, onChange, primaryColor, large, autoFocus }} />
    case 'multiple_choice':
    case 'dropdown':
      return question.question_type === 'dropdown' && !large
        ? <Dropdown {...{ opts, value, onChange }} />
        : <ChoiceList {...{ opts, value, onChange, primaryColor, large, multi: false }} />
    case 'checkbox':
      return <ChoiceList {...{ opts, value, onChange, primaryColor, large, multi: true }} />
    case 'yes_no':
      return <YesNo {...{ value, onChange, primaryColor, large }} />
    case 'ranking':
      return <Ranking {...{ opts, value, onChange, primaryColor }} />
    case 'linear_scale':
      return <LinearScale {...{ options: o, value, onChange, primaryColor, large }} />
    case 'opinion_scale':
      return <LinearScale {...{ options: o, value, onChange, primaryColor, large }} pill />
    case 'rating':
      return <Rating {...{ options: o, value, onChange }} />
    case 'date':
      return <DatePicker mode="date" value={(value as string) || null} onChange={v => onChange(v ?? '')} />
    case 'time':
      return <DatePicker mode="time" value={(value as string) || null} onChange={v => onChange(v ?? '')} />
    case 'file_upload':
      return <FileUpload {...{ value, onChange, primaryColor, token }} />
    case 'signature':
      return <Signature {...{ value, onChange, primaryColor }} />
    case 'video':
      // Content question: nothing is collected, the video is simply played.
      return <VideoBlock options={question.options} title={question.title} />
    case 'grid_radio':
    case 'grid_checkbox':
      return <GridInput {...{ options: o, value, onChange, primaryColor, multi: question.question_type === 'grid_checkbox' }} />
    default:
      return null
  }
}

// ── Text inputs ────────────────────────────────────────────────────────────────

function TextInput({ question, value, onChange, primaryColor, large, autoFocus, numeric }: {
  question: PublicQuestion; value: unknown; onChange: (v: unknown) => void
  primaryColor: string; large?: boolean; autoFocus?: boolean; numeric?: boolean
}) {
  const placeholder = (question.options?.placeholder as string)
    || (question.question_type === 'email' ? 'nom@exemple.com'
      : question.question_type === 'url' ? 'https://…'
      : numeric ? '0' : 'Votre réponse')
  const type = numeric ? 'number'
    : question.question_type === 'email' ? 'email'
    : question.question_type === 'url' ? 'url'
    : question.question_type === 'phone' ? 'tel' : 'text'
  return (
    <input
      type={type}
      autoFocus={autoFocus}
      value={(value as string) ?? ''}
      onChange={e => onChange(numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
      placeholder={placeholder}
      className={large
        ? 'w-full bg-transparent border-b-2 outline-none py-2 text-2xl text-gray-800 placeholder-gray-300'
        : 'w-full border-b border-gray-300 focus:border-current outline-none py-1 text-sm text-gray-700 bg-transparent'}
      style={large ? { borderColor: `${primaryColor}55` } : undefined}
    />
  )
}

function LongText({ value, onChange, primaryColor, large, autoFocus }: {
  value: unknown; onChange: (v: unknown) => void; primaryColor: string; large?: boolean; autoFocus?: boolean
}) {
  return (
    <textarea
      autoFocus={autoFocus}
      value={(value as string) ?? ''}
      onChange={e => onChange(e.target.value)}
      rows={large ? 3 : 4}
      placeholder="Votre réponse"
      className={large
        ? 'w-full bg-transparent border-b-2 outline-none py-2 text-xl text-gray-800 placeholder-gray-300 resize-none'
        : 'w-full border-b border-gray-300 outline-none py-1 text-sm text-gray-700 bg-transparent resize-none'}
      style={large ? { borderColor: `${primaryColor}55` } : undefined}
    />
  )
}

// ── Choice list (radio / checkbox / large cards) ─────────────────────────────────

function ChoiceList({ opts, value, onChange, primaryColor, large, multi }: {
  opts: Opt[]; value: unknown; onChange: (v: unknown) => void; primaryColor: string; large?: boolean; multi: boolean
}) {
  const selected = multi
    ? (Array.isArray(value) ? value as string[] : [])
    : (value != null ? [value as string] : [])

  const toggle = (id: string) => {
    if (multi) {
      const cur = Array.isArray(value) ? value as string[] : []
      onChange(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id])
    } else {
      onChange(id)
    }
  }

  // Large mode: letter-key selection (single question on screen).
  useEffect(() => {
    if (!large) return
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return
      const idx = LETTERS.indexOf(e.key.toUpperCase())
      if (idx >= 0 && idx < opts.length) { toggle(opts[idx].id); e.preventDefault() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [large, opts, value])

  return (
    <div className={large ? 'space-y-3' : 'space-y-2'}>
      {opts.map((opt, i) => {
        const on = selected.includes(opt.id)
        if (large) {
          return (
            <button
              key={opt.id}
              onClick={() => toggle(opt.id)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all hover:shadow-sm"
              style={{
                borderColor: on ? primaryColor : '#d1d5db',
                backgroundColor: on ? `${primaryColor}14` : 'white',
              }}
            >
              <span
                className="inline-flex items-center justify-center w-7 h-7 rounded-md border text-sm font-medium shrink-0"
                style={{ borderColor: on ? primaryColor : '#cbd5e1', color: on ? primaryColor : '#64748b' }}
              >
                {on ? <Check size={16} /> : LETTERS[i]}
              </span>
              <span className="flex flex-col gap-2">
                <span className="text-base text-gray-800">{opt.label}</span>
                {opt.image && <img src={opt.image} alt="" className="max-h-32 rounded" />}
              </span>
            </button>
          )
        }
        return (
          <button
            key={opt.id}
            onClick={() => toggle(opt.id)}
            className="w-full flex items-center gap-2.5 text-left"
          >
            <span
              className={`shrink-0 w-5 h-5 border-2 flex items-center justify-center ${multi ? 'rounded' : 'rounded-full'}`}
              style={{ borderColor: on ? primaryColor : '#9ca3af', backgroundColor: on ? primaryColor : 'transparent' }}
            >
              {on && <Check size={12} className="text-white" />}
            </span>
            <span className="flex flex-col gap-1.5">
              <span className="text-sm text-gray-700">{opt.label}</span>
              {opt.image && <img src={opt.image} alt="" className="max-h-28 rounded" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Dropdown({ opts, value, onChange }: { opts: Opt[]; value: unknown; onChange: (v: unknown) => void }) {
  return (
    <div className="relative">
      <UiDropdown
        value={(value as string) ?? ''}
        onChange={v => onChange(v)}
        options={opts.map(o => ({ value: o.id, label: o.label }))}
        placeholder="Choisir…"
        width="100%" height={38} fontSize={14}
      />
    </div>
  )
}

function YesNo({ value, onChange, primaryColor, large }: {
  value: unknown; onChange: (v: unknown) => void; primaryColor: string; large?: boolean
}) {
  const items = [{ id: 'yes', label: 'Oui', Icon: Check }, { id: 'no', label: 'Non', Icon: X }]
  return (
    <div className={`flex gap-3 ${large ? '' : 'max-w-xs'}`}>
      {items.map(({ id, label, Icon }) => {
        const on = value === id
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 py-3 transition-all"
            style={{ borderColor: on ? primaryColor : '#d1d5db', backgroundColor: on ? `${primaryColor}14` : 'white', color: on ? primaryColor : '#374151' }}
          >
            <Icon size={18} /> {label}
          </button>
        )
      })}
    </div>
  )
}

function Ranking({ opts, value, onChange, primaryColor }: {
  opts: Opt[]; value: unknown; onChange: (v: unknown) => void; primaryColor: string
}) {
  // value is an ordered list of option ids; seed with the natural order.
  const order: string[] = Array.isArray(value) && value.length
    ? (value as string[]).filter(id => opts.some(o => o.id === id))
    : opts.map(o => o.id)
  // Append any new options not yet in the order.
  for (const o of opts) if (!order.includes(o.id)) order.push(o.id)

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {order.map((id, i) => {
        const opt = opts.find(o => o.id === id)
        if (!opt) return null
        return (
          <div key={id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 bg-white">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white" style={{ backgroundColor: primaryColor }}>{i + 1}</span>
            <span className="flex-1 text-sm text-gray-700">{opt.label}</span>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowUp size={16} /></button>
            <button onClick={() => move(i, 1)} disabled={i === order.length - 1} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowDown size={16} /></button>
          </div>
        )
      })}
    </div>
  )
}

function LinearScale({ options, value, onChange, primaryColor, large, pill }: {
  options: Record<string, unknown>; value: unknown; onChange: (v: unknown) => void
  primaryColor: string; large?: boolean; pill?: boolean
}) {
  const min = (options?.min as number) ?? (pill ? 0 : 1)
  const max = (options?.max as number) ?? (pill ? 10 : 5)
  const minLabel = options?.minLabel as string
  const maxLabel = options?.maxLabel as string
  const range = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  return (
    <div className="flex flex-col gap-2">
      <div className={`flex ${pill ? 'flex-wrap' : ''} gap-2 ${large ? 'justify-start' : 'items-center'}`}>
        {range.map(n => {
          const on = value === n
          return (
            <button
              key={n}
              onClick={() => onChange(n)}
              className={`${large ? 'w-12 h-12 text-base' : 'w-9 h-9 text-sm'} rounded-full border-2 font-medium transition-colors`}
              style={{ borderColor: on ? primaryColor : '#d1d5db', backgroundColor: on ? primaryColor : 'transparent', color: on ? 'white' : '#374151' }}
            >
              {n}
            </button>
          )
        })}
      </div>
      {(minLabel || maxLabel) && (
        <div className="flex justify-between text-xs text-gray-500">
          <span>{minLabel}</span><span>{maxLabel}</span>
        </div>
      )}
    </div>
  )
}

function Rating({ options, value, onChange }: { options: Record<string, unknown>; value: unknown; onChange: (v: unknown) => void }) {
  const max = (options?.max as number) ?? 5
  const isHeart = options?.icon === 'heart'
  const Icon = isHeart ? Heart : Star
  const [hover, setHover] = useState(0)
  const active = hover || (value as number) || 0
  return (
    <div className="flex gap-2">
      {Array.from({ length: max }, (_, i) => i + 1).map(n => (
        <button key={n} onClick={() => onChange(n)} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}>
          <Icon size={32} style={{ color: active >= n ? (isHeart ? '#ef4444' : '#fbbf24') : '#d1d5db', fill: active >= n ? (isHeart ? '#ef4444' : '#fbbf24') : 'none' }} />
        </button>
      ))}
    </div>
  )
}

function FileUpload({ value, onChange, primaryColor, token }: {
  value: unknown; onChange: (v: unknown) => void; primaryColor: string; token: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const file = value as UploadedFile | undefined
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (f: File | undefined) => {
    if (!f) return
    setBusy(true); setError('')
    try {
      const res = await publicFormsApi.upload(token, f)
      onChange(res.data)
    } catch {
      setError('Échec du téléversement.')
    } finally {
      setBusy(false)
    }
  }

  if (file?.fileId) {
    return (
      <div className="flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3">
        <FileCheck2 size={20} style={{ color: primaryColor }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-800 truncate">{file.name}</div>
          <div className="text-xs text-gray-400">{Math.round((file.size ?? 0) / 1024)} Ko</div>
        </div>
        <button onClick={() => onChange(null)} className="text-gray-400 hover:text-red-500"><X size={18} /></button>
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="w-full border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-gray-400 transition-colors"
      >
        <Upload size={24} className="mx-auto mb-2 text-gray-400" />
        <span className="text-sm" style={{ color: primaryColor }}>{busy ? 'Téléversement…' : 'Choisir un fichier'}</span>
      </button>
      <input ref={inputRef} type="file" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  )
}

function Signature({ value, onChange, primaryColor }: { value: unknown; onChange: (v: unknown) => void; primaryColor: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (ctx && typeof value === 'string' && value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0)
      img.src = value
    }
  }, [])

  const pos = (e: ReactPointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const start = (e: ReactPointerEvent) => { drawing.current = true; last.current = pos(e) }
  const draw = (e: ReactPointerEvent) => {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const p = pos(e)
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 2; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(last.current!.x, last.current!.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p
  }
  const end = () => {
    drawing.current = false
    const canvas = canvasRef.current!
    onChange(canvas.toDataURL('image/png'))
  }
  const clear = () => {
    const canvas = canvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    onChange('')
  }
  return (
    <div>
      <canvas
        ref={canvasRef}
        width={460}
        height={160}
        onPointerDown={start}
        onPointerMove={draw}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full border-2 rounded-xl touch-none bg-white"
        style={{ borderColor: `${primaryColor}55` }}
      />
      <button onClick={clear} className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700">
        <Eraser size={14} /> Effacer
      </button>
    </div>
  )
}

function GridInput({ options, value, onChange, primaryColor, multi }: {
  options: Record<string, unknown>; value: unknown; onChange: (v: unknown) => void; primaryColor: string; multi: boolean
}) {
  const rows = (options?.rows as Opt[]) ?? []
  const cols = (options?.columns as Opt[]) ?? []
  const grid = (value && typeof value === 'object' ? value : {}) as Record<string, string | string[]>

  const set = (rowId: string, colId: string) => {
    const next = { ...grid }
    if (multi) {
      const cur = Array.isArray(next[rowId]) ? next[rowId] as string[] : []
      next[rowId] = cur.includes(colId) ? cur.filter(c => c !== colId) : [...cur, colId]
    } else {
      next[rowId] = colId
    }
    onChange(next)
  }
  const isOn = (rowId: string, colId: string) => {
    const v = grid[rowId]
    return multi ? Array.isArray(v) && v.includes(colId) : v === colId
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-sm text-gray-700">
        <thead>
          <tr>
            <th />
            {cols.map(c => <th key={c.id} className="px-3 py-1 font-normal text-gray-500 text-center">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="pr-3 py-1.5">{r.label}</td>
              {cols.map(c => (
                <td key={c.id} className="text-center px-3">
                  <button onClick={() => set(r.id, c.id)}
                    className={`w-5 h-5 border-2 inline-flex items-center justify-center ${multi ? 'rounded' : 'rounded-full'}`}
                    style={{ borderColor: isOn(r.id, c.id) ? primaryColor : '#9ca3af', backgroundColor: isOn(r.id, c.id) ? primaryColor : 'transparent' }}>
                    {isOn(r.id, c.id) && <Check size={11} className="text-white" />}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
