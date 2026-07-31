import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  RotateCcw, RotateCw, FlipHorizontal, FlipVertical, Undo2,
} from 'lucide-react'
import { Button, Separator, RangeSlider } from '@ui'

/**
 * Editor for the form banner: frame it, turn it, mirror it, and correct its
 * tones.
 *
 * Geometry (rotate / flip) REBUILDS the bitmap instead of applying a CSS
 * transform, so the picture can never spill out of its stage and the crop frame
 * always shares the screen's axes — dragging a handle stays predictable.
 * Tone settings stay live (same filter string previews in CSS and bakes in
 * canvas) so they remain adjustable until the user saves.
 *
 * Everything is BAKED into a new image on save rather than stored as settings —
 * the banner is served to anonymous respondents as a plain URL, so what they
 * fetch must already be edited.
 */

interface Crop { x: number; y: number; w: number; h: number }
interface Tone { brightness: number; contrast: number; saturate: number; grayscale: number; sepia: number; blur: number }

const HANDLE = 12
const NEUTRAL: Tone = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, blur: 0 }

const PRESETS: Array<{ id: string; label: string; tone: Tone }> = [
  { id: 'none',   label: 'Aucun',      tone: NEUTRAL },
  { id: 'mono',   label: 'Noir et blanc', tone: { ...NEUTRAL, grayscale: 100 } },
  { id: 'sepia',  label: 'Sépia',      tone: { ...NEUTRAL, sepia: 80 } },
  { id: 'vivid',  label: 'Éclatant',   tone: { ...NEUTRAL, saturate: 145, contrast: 110 } },
  { id: 'soft',   label: 'Doux',       tone: { ...NEUTRAL, brightness: 108, saturate: 90, contrast: 92 } },
]

const filterOf = (t: Tone) =>
  `brightness(${t.brightness}%) contrast(${t.contrast}%) saturate(${t.saturate}%)` +
  ` grayscale(${t.grayscale}%) sepia(${t.sepia}%)${t.blur ? ` blur(${t.blur}px)` : ''}`

/** Largest frame of the wanted ratio that fits, centred. */
function fitCrop(w: number, h: number, aspect: number): Crop {
  const cw = Math.min(w, h * aspect)
  const ch = cw / aspect
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch }
}

function Slider({ label, value, min, max, unit, disabled, onChange }: {
  label: string; value: number; min: number; max: number; unit: string
  disabled?: boolean; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3 text-xs text-text-secondary">
      <span className="w-20 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">
        <RangeSlider value={value} min={min} max={max} disabled={disabled}
          onChange={onChange} format={v => `${v}${unit}`} />
      </div>
    </div>
  )
}

function Tool({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode
}) {
  return (
    <Button variant="ghost" size="sm" title={label} aria-label={label}
      onClick={onClick} disabled={disabled} className="w-9 px-0">
      {children}
    </Button>
  )
}

export default function HeaderImageEditor({ src, aspect, busy, onSave, onCancel }: {
  src:    string
  /** Width / height the banner is displayed at; the crop is locked to it. */
  aspect: number
  busy?:  boolean
  onSave: (file: File) => void
  onCancel: () => void
}) {
  const [img,   setImg]   = useState<HTMLImageElement | null>(null)
  const [crop,  setCrop]  = useState<Crop | null>(null)
  const [tone,  setTone]  = useState<Tone>(NEUTRAL)
  const [preset, setPreset] = useState('none')
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef  = useRef<{ mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number; start: Crop } | null>(null)

  useEffect(() => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload  = () => { setImg(el); setCrop(fitCrop(el.naturalWidth, el.naturalHeight, aspect)) }
    el.onerror = () => setError("L'image n'a pas pu être chargée.")
    el.src = src
  }, [src, aspect])

  // The stage drives the display scale, so its size has to be state, not a
  // read during render (which would be stale on the very first paint).
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setStage({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  /** Redraws the bitmap through `paint`, then reframes it. */
  const remap = useCallback((w: number, h: number, paint: (ctx: CanvasRenderingContext2D, el: HTMLImageElement) => void) => {
    if (!img) return
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { setError("La transformation n'a pas pu être appliquée."); return }
    paint(ctx, img)
    const next = new Image()
    next.onload = () => { setImg(next); setCrop(fitCrop(next.naturalWidth, next.naturalHeight, aspect)) }
    next.src = canvas.toDataURL('image/png')
  }, [img, aspect])

  const rotate = (dir: 1 | -1) => {
    if (!img) return
    remap(img.naturalHeight, img.naturalWidth, (ctx, el) => {
      ctx.translate(el.naturalHeight / 2, el.naturalWidth / 2)
      ctx.rotate((dir * Math.PI) / 2)
      ctx.drawImage(el, -el.naturalWidth / 2, -el.naturalHeight / 2)
    })
  }

  const flip = (axis: 'x' | 'y') => {
    if (!img) return
    remap(img.naturalWidth, img.naturalHeight, (ctx, el) => {
      ctx.translate(axis === 'x' ? el.naturalWidth : 0, axis === 'y' ? el.naturalHeight : 0)
      ctx.scale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1)
      ctx.drawImage(el, 0, 0)
    })
  }

  const reset = () => {
    setTone(NEUTRAL); setPreset('none')
    if (img) setCrop(fitCrop(img.naturalWidth, img.naturalHeight, aspect))
  }

  const setToneField = (k: keyof Tone) => (v: number) => {
    setTone(t => ({ ...t, [k]: v })); setPreset('custom')
  }

  const scale = img && stage.w && stage.h
    ? Math.min(stage.w / img.naturalWidth, stage.h / img.naturalHeight)
    : 0

  const onPointerDown = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => {
    if (!crop) return
    e.preventDefault(); e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { mode, x: e.clientX, y: e.clientY, start: { ...crop } }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || !img || !scale) return
    const dx = (e.clientX - d.x) / scale
    const dy = (e.clientY - d.y) / scale
    const s  = d.start

    if (d.mode === 'move') {
      setCrop({
        ...s,
        x: Math.max(0, Math.min(img.naturalWidth  - s.w, s.x + dx)),
        y: Math.max(0, Math.min(img.naturalHeight - s.h, s.y + dy)),
      })
      return
    }

    // Corner drag: width leads, height follows to keep the banner ratio.
    const grow = d.mode === 'nw' || d.mode === 'sw' ? -dx : dx
    let w = Math.max(48, s.w + grow)
    let h = w / aspect
    let x = d.mode === 'nw' || d.mode === 'sw' ? s.x + s.w - w : s.x
    let y = d.mode === 'nw' || d.mode === 'ne' ? s.y + s.h - h : s.y

    // Clamp inside the picture without breaking the ratio.
    if (x < 0)                     { w += x; h = w / aspect; x = 0 }
    if (y < 0)                     { h += y; w = h * aspect; y = 0 }
    if (x + w > img.naturalWidth)  { w = img.naturalWidth  - x; h = w / aspect }
    if (y + h > img.naturalHeight) { h = img.naturalHeight - y; w = h * aspect }
    setCrop({ x, y, w, h })
  }

  const onPointerUp = () => { dragRef.current = null }

  const save = () => {
    if (!img || !crop) return
    const canvas = document.createElement('canvas')
    canvas.width  = Math.round(crop.w)
    canvas.height = Math.round(crop.h)
    const ctx = canvas.getContext('2d')
    if (!ctx) { setError("Les modifications n'ont pas pu être appliquées."); return }
    // Same filter string as the live preview, so what is saved is what is seen.
    ctx.filter = filterOf(tone)
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(blob => {
      if (!blob) { setError("Les modifications n'ont pas pu être appliquées."); return }
      onSave(new File([blob], 'header.png', { type: 'image/png' }))
    }, 'image/png')
  }

  const dispW = img ? img.naturalWidth  * scale : 0
  const dispH = img ? img.naturalHeight * scale : 0
  const pct   = (v: number, total: number) => `${(v / total) * 100}%`

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-4xl h-[44rem] max-h-[92vh] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <h2 className="px-6 py-4 text-xl text-gray-800 shrink-0">Modifier l'image d'en-tête</h2>

        {/* Bounded stage: the picture is scaled to fit and clipped, so it can
            never grow over the controls below. */}
        <div ref={stageRef}
          className="flex-1 min-h-0 mx-6 relative flex items-center justify-center overflow-hidden select-none rounded-lg border border-gray-200 bg-gray-100"
          onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          {error && <p className="text-xs text-red-600 px-4 text-center">{error}</p>}
          {!error && !img && <p className="text-xs text-gray-500">Chargement…</p>}

          {img && crop && scale > 0 && (
            <div className="relative" style={{ width: dispW, height: dispH }}>
              <img src={img.src} alt="" draggable={false} className="w-full h-full block"
                style={{ filter: filterOf(tone) }} />
              {/* Everything outside the frame is dimmed. */}
              <div className="absolute inset-0 bg-black/40 pointer-events-none" style={{
                clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0,
                  ${pct(crop.x, img.naturalWidth)} ${pct(crop.y, img.naturalHeight)},
                  ${pct(crop.x, img.naturalWidth)} ${pct(crop.y + crop.h, img.naturalHeight)},
                  ${pct(crop.x + crop.w, img.naturalWidth)} ${pct(crop.y + crop.h, img.naturalHeight)},
                  ${pct(crop.x + crop.w, img.naturalWidth)} ${pct(crop.y, img.naturalHeight)},
                  ${pct(crop.x, img.naturalWidth)} ${pct(crop.y, img.naturalHeight)})`,
              }} />
              <div className="absolute border-2 border-white cursor-move"
                style={{ left: crop.x * scale, top: crop.y * scale, width: crop.w * scale, height: crop.h * scale }}
                onPointerDown={onPointerDown('move')}>
                {([['nw', 'nwse'], ['ne', 'nesw'], ['sw', 'nesw'], ['se', 'nwse']] as const).map(([pos, cur]) => (
                  <span key={pos} onPointerDown={onPointerDown(pos)}
                    className="absolute bg-white border border-gray-400"
                    style={{
                      width: HANDLE, height: HANDLE, cursor: `${cur}-resize`,
                      left:   pos[1] === 'w' ? -HANDLE / 2 : undefined,
                      right:  pos[1] === 'e' ? -HANDLE / 2 : undefined,
                      top:    pos[0] === 'n' ? -HANDLE / 2 : undefined,
                      bottom: pos[0] === 's' ? -HANDLE / 2 : undefined,
                    }} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Geometry */}
        <div className="flex items-center justify-center gap-2 pt-3 shrink-0">
          <Tool label="Pivoter vers la gauche" onClick={() => rotate(-1)} disabled={!img}><RotateCcw size={19} /></Tool>
          <Tool label="Pivoter vers la droite" onClick={() => rotate(1)}  disabled={!img}><RotateCw size={19} /></Tool>
          <Separator orientation="vertical" className="h-6 mx-1" />
          <Tool label="Miroir horizontal" onClick={() => flip('x')} disabled={!img}><FlipHorizontal size={19} /></Tool>
          <Tool label="Miroir vertical"   onClick={() => flip('y')} disabled={!img}><FlipVertical size={19} /></Tool>
          <Separator orientation="vertical" className="h-6 mx-1" />
          <Tool label="Réinitialiser les réglages" onClick={reset} disabled={!img}><Undo2 size={19} /></Tool>
        </div>

        {/* Presets */}
        <div className="flex items-center justify-center gap-1.5 flex-wrap px-6 pt-3 shrink-0">
          {PRESETS.map(p => {
            const on = preset === p.id
            return (
              <Button key={p.id} size="sm" disabled={!img}
                variant={on ? 'primary' : 'secondary'}
                onClick={() => { setTone(p.tone); setPreset(p.id) }}>
                {p.label}
              </Button>
            )
          })}
        </div>

        {/* Tones */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 px-6 pt-3 shrink-0">
          <Slider label="Luminosité" value={tone.brightness} min={50} max={150} unit="%"  disabled={!img} onChange={setToneField('brightness')} />
          <Slider label="Contraste"  value={tone.contrast}   min={50} max={150} unit="%"  disabled={!img} onChange={setToneField('contrast')} />
          <Slider label="Saturation" value={tone.saturate}   min={0}  max={200} unit="%"  disabled={!img} onChange={setToneField('saturate')} />
          <Slider label="Flou"       value={tone.blur}       min={0}  max={10}  unit="px" disabled={!img} onChange={setToneField('blur')} />
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 shrink-0">
          <Button variant="ghost" onClick={onCancel}>Annuler</Button>
          <Button variant="primary" onClick={save} disabled={!img || !crop || busy}>Enregistrer</Button>
        </div>
      </div>
    </div>
  )
}
