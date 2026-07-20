import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, Link2, ListOrdered, List, RemoveFormatting } from 'lucide-react'

/**
 * Borderless rich-text field with a CONTEXTUAL toolbar: the bar only appears
 * while the field is being edited, under it — that is what the design calls for,
 * and it is why `@ui`'s RichText (a boxed editor with a permanent toolbar) does
 * not fit here.
 *
 * The value is HTML. Everything is committed on blur, like the plain inputs it
 * replaces, and sanitised server-side on save.
 */
export interface InlineRichFieldProps {
  value:       string
  onCommit:    (html: string) => void
  placeholder?: string
  /** Titles are big and drop the list buttons; descriptions are small and keep them. */
  variant?:    'title' | 'subtitle' | 'description'
  /** Theme colour — used for the focus underline. */
  color?:      string
  className?:  string
}

const VARIANT_CLASS: Record<string, string> = {
  title:       'text-2xl text-gray-800',
  subtitle:    'text-xl text-gray-800',
  description: 'text-sm text-gray-600',
}

export default function InlineRichField({
  value, onCommit, placeholder, variant = 'description', color = '#1a73e8', className,
}: InlineRichFieldProps) {
  const ref       = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [focused, setFocused] = useState(false)
  const [empty, setEmpty]     = useState(!value)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl]   = useState('')

  // Set the HTML once: rewriting it on every keystroke would reset the caret.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) ref.current.innerHTML = value || ''
    setEmpty(!ref.current?.textContent?.trim())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const html = () => {
    const el = ref.current
    if (!el) return ''
    return el.textContent?.trim() ? el.innerHTML : ''
  }

  const exec = (cmd: string, val?: string) => {
    ref.current?.focus()
    document.execCommand(cmd, false, val)
    setEmpty(!ref.current?.textContent?.trim())
  }

  const saveSel = () => {
    const s = window.getSelection()
    if (s && s.rangeCount) savedRange.current = s.getRangeAt(0).cloneRange()
  }
  const applyLink = () => {
    const s = window.getSelection()
    if (s && savedRange.current) { s.removeAllRanges(); s.addRange(savedRange.current) }
    const url = linkUrl.trim()
    if (url) exec('createLink', /^https?:\/\//i.test(url) ? url : `https://${url}`)
    setLinkOpen(false); setLinkUrl('')
    onCommit(html())
  }

  const Btn = ({ label, on, children }: { label: string; on: () => void; children: React.ReactNode }) => (
    <button type="button" title={label} aria-label={label}
      // `onMouseDown` prevented: clicking the bar must not blur the field, which
      // would drop the selection the command applies to.
      onMouseDown={e => e.preventDefault()}
      onClick={e => { e.stopPropagation(); on() }}
      className="w-8 h-8 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors">
      {children}
    </button>
  )

  return (
    <div className={className}>
      <div className="relative">
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label={placeholder}
          onInput={() => setEmpty(!ref.current?.textContent?.trim())}
          onFocus={() => setFocused(true)}
          onBlur={e => {
            // Keep the toolbar alive while the click lands on it.
            if ((e.relatedTarget as HTMLElement | null)?.closest?.('[data-rich-toolbar]')) return
            setFocused(false); setLinkOpen(false)
            onCommit(html())
          }}
          className={`w-full bg-transparent outline-none pb-1 ${VARIANT_CLASS[variant]}
            [&_a]:text-blue-600 [&_a]:underline [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ml-5 [&_ol]:ml-5`}
          style={{ borderBottom: `1px solid ${focused ? color : 'transparent'}` }}
        />
        {empty && placeholder && (
          <div className={`absolute left-0 top-0 pointer-events-none select-none text-gray-400 ${VARIANT_CLASS[variant]}`}>
            {placeholder}
          </div>
        )}
      </div>

      {focused && (
        <div data-rich-toolbar className="flex items-center gap-0.5 pt-1" onMouseDown={e => e.preventDefault()}>
          <Btn label="Gras"      on={() => exec('bold')}><Bold size={15} /></Btn>
          <Btn label="Italique"  on={() => exec('italic')}><Italic size={15} /></Btn>
          <Btn label="Souligné"  on={() => exec('underline')}><Underline size={15} /></Btn>
          <Btn label="Insérer un lien" on={() => { saveSel(); setLinkOpen(o => !o) }}><Link2 size={15} /></Btn>
          {variant === 'description' && (
            <>
              <Btn label="Liste numérotée" on={() => exec('insertOrderedList')}><ListOrdered size={15} /></Btn>
              <Btn label="Liste à puces"   on={() => exec('insertUnorderedList')}><List size={15} /></Btn>
            </>
          )}
          <Btn label="Effacer la mise en forme" on={() => exec('removeFormat')}><RemoveFormatting size={15} /></Btn>
        </div>
      )}

      {linkOpen && (
        <div data-rich-toolbar className="flex items-center gap-1.5 pt-1" onMouseDown={e => e.preventDefault()}>
          <input autoFocus value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…"
            onKeyDown={e => {
              if (e.key === 'Enter')  { e.preventDefault(); applyLink() }
              if (e.key === 'Escape') { setLinkOpen(false); setLinkUrl('') }
            }}
            className="flex-1 text-sm px-2 py-1 rounded border border-gray-300 outline-none focus:border-blue-500" />
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={applyLink}
            className="text-sm font-medium px-2" style={{ color }}>OK</button>
        </div>
      )}
    </div>
  )
}
