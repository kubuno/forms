import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X, Image as ImageIcon, Plus } from 'lucide-react'
import { FontSizeField, ColorPicker, AnchoredPopover, useAppPickerTheme } from '@ui'
import { formsApi, type Form, type FormTheme, type FormTextStyle } from './api'
import { pickImageFile } from '@kubuno/sdk'

/**
 * Theme panel, docked to the right of the editor: typography per text role,
 * header image, accent colour and background shade.
 *
 * Replaces the small colour popover — the theme is more than an accent, and a
 * side panel can stay open while the form is edited behind it.
 */

const ACCENTS = [
  '#d93025', '#673ab7', '#3f51b5', '#1a73e8', '#039be5', '#00acc1',
  '#f4511e', '#f09300', '#00796b', '#0f9d58', '#607d8b', '#9e9e9e',
  '#e91e63', '#9c27b0', '#4527a0', '#01579b', '#33691e', '#827717',
  '#ff7043', '#795548', '#5f6368',
]

/** Fonts and sizes offered for the form's typography. */
const FONTS = ['Google Sans Text', 'Google Sans', 'Roboto', 'Georgia', 'Courier New', 'Times New Roman'] as const
const SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40] as const

const DEFAULT_TEXT: Record<'headerText' | 'questionText' | 'bodyText', FormTextStyle> = {
  headerText:   { font: 'Google Sans', size: 24 },
  questionText: { font: 'Google Sans Text', size: 16 },
  bodyText:     { font: 'Google Sans Text', size: 14 },
}

/** Four background shades derived from the accent, lightest to plain white. */
const shades = (accent: string) => [
  `color-mix(in srgb, ${accent} 14%, white)`,
  `color-mix(in srgb, ${accent} 8%, white)`,
  `color-mix(in srgb, ${accent} 4%, white)`,
  '#ffffff',
]

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-text-primary mb-2">{children}</div>
}

export default function ThemePanel({ form, onClose, onUpdate, onHeaderChanged }: {
  form: Form
  onClose: () => void
  onUpdate: (theme: Partial<FormTheme>) => void
  onHeaderChanged: () => void
}) {
  const t = form.theme
  const accent = t.primaryColor
  const plusRef = useRef<HTMLButtonElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Derives the picker's palette from the app's CSS variables, so it follows
  // the current theme instead of always rendering dark.
  const pickerTheme = useAppPickerTheme()

  /**
   * Pinned to the editor's header bar rather than laid out with the content:
   * the panel must be at rest the moment it opens, not slide up into place as
   * the list scrolls. It is measured off `[data-editor-header]`, so it lines up
   * with the toolbar and stops at the module's right edge — not the window's,
   * which sits under the shell dock.
   */
  const [box, setBox] = useState<{ top: number; right: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const bar = document.querySelector('[data-editor-header]')
      if (!bar) return
      const r = bar.getBoundingClientRect()
      setBox({ top: r.bottom, right: window.innerWidth - r.right, height: window.innerHeight - r.bottom })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  // The header is sticky: its bottom can shift while the page settles.
  useEffect(() => {
    const id = window.setInterval(() => {
      const bar = document.querySelector('[data-editor-header]')
      if (!bar) return
      const r = bar.getBoundingClientRect()
      setBox(b => (b && Math.abs(b.top - r.bottom) < 1 ? b
        : { top: r.bottom, right: window.innerWidth - r.right, height: window.innerHeight - r.bottom }))
    }, 400)
    return () => window.clearInterval(id)
  }, [])

  const text = (role: keyof typeof DEFAULT_TEXT): FormTextStyle => t[role] ?? DEFAULT_TEXT[role]
  const setText = (role: keyof typeof DEFAULT_TEXT, patch: Partial<FormTextStyle>) =>
    onUpdate({ [role]: { ...text(role), ...patch } } as Partial<FormTheme>)

  const replaceHeader = async () => {
    const file = await pickImageFile({ title: "Image d'en-tête" })
    if (!file) return
    await formsApi.uploadHeader(form.id, file)
    onHeaderChanged()
  }

  const removeHeader = async () => {
    await formsApi.deleteHeader(form.id)
    onHeaderChanged()
  }

  return (
    <aside
      className="fixed z-20 w-80 overflow-y-auto bg-white border-l border-border"
      style={{ top: box?.top ?? 0, right: box?.right ?? 0, height: box?.height ?? '100vh' }}
    >
      <header className="flex items-center gap-3 px-4 h-14 border-b border-border sticky top-0 bg-white">
        <span className="text-base text-text-primary flex-1">Thème</span>
        <button onClick={onClose} aria-label="Fermer" title="Fermer"
          className="w-8 h-8 flex items-center justify-center rounded-full text-text-secondary hover:bg-surface-2">
          <X size={18} />
        </button>
      </header>

      <section className="px-4 py-4 border-b border-border">
        <Label>Style de texte</Label>
        {([
          ['headerText',   'En-tête'],
          ['questionText', 'Question'],
          ['bodyText',     'Texte'],
        ] as const).map(([role, label]) => (
          <div key={role} className="mb-3 last:mb-0">
            <div className="text-xs text-text-secondary mb-1">{label}</div>
            <FontSizeField
              font={text(role).font}
              fonts={FONTS}
              size={String(text(role).size)}
              sizes={SIZES}
              onFontChange={f => setText(role, { font: f })}
              onSizeChange={v => { const n = parseInt(v, 10); if (!Number.isNaN(n)) setText(role, { size: n }) }}
            />
          </div>
        ))}
      </section>

      <section className="px-4 py-4 border-b border-border">
        <Label>En-tête</Label>
        {form.header_image_path ? (
          <div className="flex items-center gap-2 border border-border rounded-lg px-3 h-10">
            <ImageIcon size={16} style={{ color: accent }} />
            <button onClick={() => { void replaceHeader() }} className="flex-1 text-left text-xs text-text-primary truncate">
              Image importée
            </button>
            <button onClick={() => { void removeHeader() }} aria-label="Retirer l'image" title="Retirer l'image"
              className="w-6 h-6 flex items-center justify-center rounded-full text-text-secondary hover:bg-surface-2">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button onClick={() => { void replaceHeader() }}
            className="w-full flex items-center gap-2 border border-border rounded-lg px-3 h-10 text-xs text-text-secondary hover:bg-surface-1">
            <ImageIcon size={16} /> Choisir une image
          </button>
        )}
      </section>

      <section className="px-4 py-4">
        <Label>Couleur</Label>
        <div className="flex flex-wrap gap-2 mb-4">
          {ACCENTS.map(c => (
            <button key={c} onClick={() => onUpdate({ primaryColor: c, headerColor: c })}
              aria-label={`Couleur ${c}`} title={c}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110"
              style={{ backgroundColor: c }}>
              {accent.toLowerCase() === c && <span className="text-white text-xs">✓</span>}
            </button>
          ))}
          <button ref={plusRef} onClick={() => setPickerOpen(o => !o)}
            aria-label="Couleur personnalisée" title="Couleur personnalisée"
            className="w-8 h-8 rounded-full flex items-center justify-center bg-surface-2 text-text-secondary hover:bg-surface-3">
            <Plus size={16} />
          </button>
        </div>
        {/* Floats beside the panel rather than expanding inside it, which would
            push the rest of the theme controls down. */}
        <AnchoredPopover anchorRef={plusRef} open={pickerOpen} onClose={() => setPickerOpen(false)} align="right">
          <ColorPicker color={accent} C={pickerTheme} onClose={() => setPickerOpen(false)}
            onChange={(c: string) => onUpdate({ primaryColor: c, headerColor: c })} />
        </AnchoredPopover>

        <div className="flex items-center gap-3">
          <span className="text-xs text-text-primary">Arrière-plan</span>
          <div className="flex gap-2">
            {shades(accent).map(bg => {
              const on = (t.backgroundColor ?? shades(accent)[1]) === bg
              return (
                <button key={bg} onClick={() => onUpdate({ backgroundColor: bg })}
                  aria-label="Nuance d'arrière-plan"
                  className="w-8 h-8 rounded-full border border-border flex items-center justify-center"
                  style={{ background: bg }}>
                  {on && <span className="text-text-primary text-xs">✓</span>}
                </button>
              )
            })}
          </div>
        </div>
      </section>
    </aside>
  )
}
