import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Eye, Send, Trash2, Copy, GripVertical, ChevronDown,
  ArrowLeft, BarChart2, ClipboardList,
  Trophy, Star, Heart, Check,
  ImagePlus, ImageIcon, RefreshCw, SlidersHorizontal, CirclePlus, FileInput, Type as TypeIcon,
  Table2, Download, Printer, Bell, BellRing, Code2, Palette, Link2, UserPlus, Share,
  Video, Rows3, X, Undo2, Redo2, MoreVertical,
} from 'lucide-react'
import { formsApi, collaboratorsApi, type Form, type Question, type QuestionType } from './api'
import { plainText } from './plainText'
import HeaderImageEditor from './HeaderImageEditor'
import BlockGhost, { measureBlock, type GhostShape } from './BlockGhost'
import FormSettingsTab from './FormSettingsTab'
import ThemePanel from './ThemePanel'
import { openShare } from './shareSdk'
import { useModulePrefs, FORM_DEFAULTS, type FormDefaults } from './userPrefs'

/** Only the key this tab touches; the settings page owns the rest. */
type FormsNotifyPrefs = { notifyOnReply: boolean }
import { DatePicker, Dropdown, Button, Checkbox, MenuDropdown, useMenuDropdown, Toggle, ConfirmDialog, type MenuItem, Tooltip } from '@ui'
import { useConfirm, pickImageFile } from '@kubuno/sdk'
import {
  QUESTION_TYPES, getMeta, defaultOptionsFor, isContentType,
} from './questionTypes'
import OptionsEditor from './OptionsEditor'
import VideoBlock from './VideoBlock'
import InlineRichField from './InlineRichField'
import LogicEditor from './LogicEditor'
import { useEditorHistory, isTypingTarget, type IdRef } from './useEditorHistory'

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

/** Sentinel selection id for the form's own title card (it has no question row). */
const FORM_CARD_ID = '__form__'

export default function FormEditorPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const [activeTab, setActiveTab]               = useState<Tab>('questions')
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null)
  // Whether the active block's band is out on the left (vs folded inside).
  const railOut = useRoomForRail()
  const [showImport, setShowImport]             = useState(false)
  const [showThemePicker, setShowThemePicker]   = useState(false)
  const dragId = useRef<string | null>(null)
  // A finished drag is followed by a stray `click` on the common ancestor of
  // press and release — which the click-away handler would read as "clicked
  // outside" and drop the selection. Timestamped so a drag that ends without a
  // click never swallows a later one.
  const draggedAt = useRef(0)
  // Only feedback during a block drag: the silhouette of the slot it would
  // land in — the block's real outline, band and S-curve included.
  const [ghost, setGhost] = useState<GhostShape | null>(null)

  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: ['form', id] }) }, [qc, id])
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()
  const formMenu = useMenuDropdown()
  const history = useEditorHistory(refresh)

  const { data, isLoading } = useQuery({
    queryKey: ['form', id],
    queryFn:  () => formsApi.get(id!).then(r => r.data),
    enabled:  !!id,
  })

  const updateFormMut = useMutation({
    mutationFn: (patch: Parameters<typeof formsApi.update>[1]) => formsApi.update(id!, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['form', id] }),
  })

  /** Patch the form and record the inverse patch for undo. */
  const patchForm = useCallback((patch: Record<string, unknown>, before: Record<string, unknown>) => {
    type P = Parameters<typeof formsApi.update>[1]
    // A blur that changed nothing must not enter the history: it would sit on
    // top of the stack and swallow the user's next Ctrl+Z.
    const changed = Object.keys(patch).some(k => !Object.is(patch[k], before[k]))
    if (!changed) return
    updateFormMut.mutate(patch as P)
    history.push({
      label: 'form',
      undo: async () => { await formsApi.update(id!, before as P) },
      redo: async () => { await formsApi.update(id!, patch as P) },
    })
  }, [updateFormMut, history, id])
  // Per-user defaults seeded into every new question (Paramètres → Valeurs par défaut).
  const { prefs: formDefaults } = useModulePrefs<FormDefaults>('forms-defaults', FORM_DEFAULTS)

  const createQuestionMut = useMutation({
    mutationFn: (type: QuestionType) => {
      // A new block starts at the selected one: it lands just after it, and the
      // server pushes the rest down. With no selection it is appended.
      const active = (data?.questions ?? []).find(q => q.id === activeQuestionId)
      const position = active
        ? (type === 'section' ? active.position : active.position + 1)
        : undefined
      return formsApi.createQuestion(id!, {
        question_type: type,
        ...(position != null ? { position } : {}),
      })
    },
    onSuccess:  async (r) => {
      const q = r.data.question
      // Seed default options for the new question type.
      const opts = defaultOptionsFor(q.question_type)
      // Content blocks (title, image, section…) are never answered, so the
      // "required by default" preference must not reach them.
      const required = formDefaults.defaultRequired && !isContentType(q.question_type)
      const seed: Partial<Question> = {
        ...(Object.keys(opts).length ? { options: opts } : {}),
        ...(required ? { required: true } : {}),
      }
      if (Object.keys(seed).length) await formsApi.updateQuestion(id!, q.id, seed)
      setActiveQuestionId(q.id)
      qc.invalidateQueries({ queryKey: ['form', id] })

      // Redo recreates the row, so its id changes: share it through a box.
      const ref: IdRef = { current: q.id }
      history.push({
        label: 'create',
        undo: async () => { await formsApi.deleteQuestion(id!, ref.current) },
        redo: async () => {
          const again = await formsApi.createQuestion(id!, {
            question_type: q.question_type, title: q.title, position: q.position,
          })
          ref.current = again.data.question.id
          if (Object.keys(opts).length) await formsApi.updateQuestion(id!, ref.current, { options: opts })
        },
      })
    },
  })
  const updateQuestionMut = useMutation({
    mutationFn: ({ qid, patch }: { qid: string; patch: Partial<Question> }) => formsApi.updateQuestion(id!, qid, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['form', id] }),
  })

  /** Patch a question and record the reverse patch (only the touched fields). */
  const patchQuestion = useCallback((qid: string, patch: Partial<Question>) => {
    const before = (data?.questions ?? []).find(q => q.id === qid)
    // Same guard as the form: no-op edits stay out of the history.
    if (before && Object.keys(patch).every(k =>
      Object.is((patch as Record<string, unknown>)[k], (before as unknown as Record<string, unknown>)[k]))) return
    updateQuestionMut.mutate({ qid, patch })
    if (!before) return
    const inverse: Partial<Question> = {}
    for (const k of Object.keys(patch) as Array<keyof Question>) {
      (inverse as Record<string, unknown>)[k] = before[k]
    }
    const ref: IdRef = { current: qid }
    history.push({
      label: 'update',
      undo: async () => { await formsApi.updateQuestion(id!, ref.current, inverse) },
      redo: async () => { await formsApi.updateQuestion(id!, ref.current, patch) },
    })
  }, [data, updateQuestionMut, history, id])
  const deleteQuestionMut = useMutation({
    mutationFn: (qid: string) => formsApi.deleteQuestion(id!, qid),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['form', id] }); setActiveQuestionId(null) },
  })

  /** Delete a question, keeping enough of it to rebuild it on undo. */
  const removeQuestion = useCallback((qid: string) => {
    const snapshot = (data?.questions ?? []).find(q => q.id === qid)
    deleteQuestionMut.mutate(qid)
    if (!snapshot) return
    const ref: IdRef = { current: qid }
    const restore = async () => {
      const again = await formsApi.createQuestion(id!, {
        question_type: snapshot.question_type, title: snapshot.title, position: snapshot.position,
      })
      ref.current = again.data.question.id
      await formsApi.updateQuestion(id!, ref.current, {
        description: snapshot.description, required: snapshot.required, options: snapshot.options,
        points: snapshot.points, correct_answers: snapshot.correct_answers,
      })
    }
    history.push({
      label: 'delete',
      undo: restore,
      redo: async () => { await formsApi.deleteQuestion(id!, ref.current) },
    })
  }, [data, deleteQuestionMut, history, id])
  const duplicateQuestionMut = useMutation({
    mutationFn: (qid: string) => formsApi.duplicateQuestion(id!, qid),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['form', id] }),
  })
  const reorderMut = useMutation({
    mutationFn: (items: Array<{ id: string; position: number }>) => formsApi.reorderQuestions(id!, items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['form', id] }),
  })

  // ── Section-level actions ───────────────────────────────────────────────
  // A section is the `section` block plus every question up to the next one
  // (section 1 has no block: it starts at the top of the form).

  /** Copy a whole section right after itself. */
  const duplicateSection = useCallback(async (items: Question[]) => {
    if (items.length === 0) return
    const start = Math.max(...items.map(q => q.position)) + 1
    for (let i = 0; i < items.length; i++) {
      const src = items[i]
      const created = await formsApi.createQuestion(id!, {
        question_type: src.question_type, title: src.title, position: start + i,
      })
      await formsApi.updateQuestion(id!, created.data.question.id, {
        description: src.description, required: src.required, options: src.options,
        points: src.points, correct_answers: src.correct_answers,
      })
    }
    refresh()
  }, [id, refresh])

  /** Delete a section and everything it contains. */
  const deleteSection = useCallback(async (items: Question[]) => {
    const ok = await confirm({
      title: 'Supprimer la section',
      message: `Cette section et ses ${items.length} bloc(s) seront supprimés.`,
      confirmLabel: 'Supprimer', variant: 'danger',
    })
    if (!ok) return
    for (const q of items) await formsApi.deleteQuestion(id!, q.id)
    setActiveQuestionId(null)
    refresh()
  }, [confirm, id, refresh])

  /** Drop the section break so its blocks join the section above. */
  const mergeSectionUp = useCallback(async (header: Question) => {
    await formsApi.deleteQuestion(id!, header.id)
    setActiveQuestionId(null)
    refresh()
  }, [id, refresh])

  /** Reorder and record the previous order for undo. */
  const applyOrder = useCallback((items: Array<{ id: string; position: number }>) => {
    const before = (data?.questions ?? []).map(q => ({ id: q.id, position: q.position }))
    reorderMut.mutate(items)
    history.push({
      label: 'reorder',
      undo: async () => { await formsApi.reorderQuestions(id!, before) },
      redo: async () => { await formsApi.reorderQuestions(id!, items) },
    })
  }, [data, reorderMut, history, id])

  /** Swap a section with the one above or below it. */
  const moveSection = useCallback((groups: Question[][], index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= groups.length) return
    const next = [...groups]
    ;[next[index], next[target]] = [next[target], next[index]]
    applyOrder(next.flat().map((q, i) => ({ id: q.id, position: i })))
  }, [applyOrder])


  // Section that owns the current selection — the rail is clamped to its bounds.
  const focusedSection = useMemo(() => {
    const groups = groupIntoSections(data?.questions ?? [])
    if (!activeQuestionId || activeQuestionId === FORM_CARD_ID) return 0
    const i = groups.findIndex(g => g.items.some(q => q.id === activeQuestionId))
    return i < 0 ? 0 : i
  }, [data, activeQuestionId])

  const form      = data?.form
  const questions = data?.questions ?? []
  const color     = (form?.theme as { primaryColor?: string })?.primaryColor ?? '#673ab7'
  const quizMode  = !!form?.settings?.quizMode

  const debounceUpdate = useCallback(
    (patch: Parameters<typeof formsApi.update>[1]) => {
      const f = data?.form
      const before: Record<string, unknown> = {}
      for (const k of Object.keys(patch)) before[k] = (f as unknown as Record<string, unknown>)?.[k]
      patchForm(patch as Record<string, unknown>, before)
    },
    [data, patchForm],
  )

  /**
   * Block dragging, same shape as the workspace Dock: pointer events (no HTML5
   * drag image, no DOM clone), and the only feedback is a GHOST RECTANGLE
   * showing the exact slot the block would land in. A 5px threshold keeps a
   * plain click on the handle from starting a drag.
   */
  const startBlockDrag = (e: React.PointerEvent, q: Question) => {
    if (e.button !== 0) return
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY }
    let moved = false
    let target: string | null = null
    dragId.current = q.id

    const cardsNow = () =>
      ([...document.querySelectorAll('[data-qid]')] as HTMLElement[])
        .map(el => ({ id: el.dataset.qid as string, el, r: el.getBoundingClientRect() }))

    // Measured once, when the drag starts: the silhouette is computed from the
    // block itself — height, band width, head height, corner radius — so it
    // fits whatever this block is (a section's band overhangs its tab and
    // carries one tool fewer). It cannot change while the block is in flight.
    const self  = (e.currentTarget as HTMLElement).closest('[data-qid]') as HTMLElement | null
    const shape = self ? measureBlock(self) : null

    const scroller = findScroller(self)
    let at = { x: start.x, y: start.y }   // last pointer position, for auto-scroll
    let raf = 0

    // Where the pointer sits inside the silhouette, so the ghost keeps that
    // grip instead of jumping its top under the cursor.
    const grabDy = shape ? start.y - shape.top : 0

    /**
     * Follows the pointer freely, and only SNAPS when the silhouette comes
     * within `SNAP` of a slot it could actually take. Away from any slot it
     * floats, and releasing there drops the move — the block goes nowhere it
     * was not shown going.
     */
    const SNAP = 28
    const place = (x: number, y: number) => {
      if (!shape) return
      void x
      const free = y - grabDy

      let best: { id: string; top: number; left: number } | null = null
      let bestDist = Infinity
      for (const c of cardsNow()) {
        if (c.id === q.id) continue
        const top = c.r.top - shape.overhang
        const d = Math.abs(free - top)
        if (d < bestDist) { bestDist = d; best = { id: c.id, top, left: c.r.left - shape.bandW } }
      }

      if (best && bestDist <= SNAP) {
        target = best.id
        setGhost({ ...shape, left: best.left, top: best.top, snapped: true })
      } else {
        target = null
        setGhost({ ...shape, top: free, snapped: false })
      }
    }

    /**
     * Auto-scroll: near the top or bottom edge of the scrolling area, the list
     * creeps in that direction so a block can be dragged past what is on screen.
     * Speed ramps up as the pointer nears the edge; the ghost is re-placed after
     * each step because scrolling moves every block under it.
     */
    const tick = () => {
      raf = 0
      const view = scrollViewport(scroller)
      const EDGE = 72, MAX = 18
      let dy = 0
      if (at.y < view.top + EDGE)         dy = -MAX * Math.min(1, (view.top + EDGE - at.y) / EDGE)
      else if (at.y > view.bottom - EDGE) dy =  MAX * Math.min(1, (at.y - (view.bottom - EDGE)) / EDGE)
      if (dy) {
        const before = scrollTopOf(scroller)
        scrollByY(scroller, dy)
        // Stop looping once the edge is reached, otherwise it spins for nothing.
        if (scrollTopOf(scroller) !== before) {
          place(at.x, at.y)
          raf = requestAnimationFrame(tick)
          return
        }
      }
    }

    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) <= 5) return
      moved = true
      at = { x: ev.clientX, y: ev.clientY }
      place(at.x, at.y)
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (raf) cancelAnimationFrame(raf)
      document.body.style.cursor = ''
      setGhost(null)
      if (moved) draggedAt.current = Date.now()
      if (moved && target) onDrop(target)
      dragId.current = null
    }

    document.body.style.cursor = 'grabbing'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Native drag & drop reorder.
  const onDrop = (targetId: string) => {
    const src = dragId.current
    dragId.current = null
    if (!src || src === targetId) return
    const ids = questions.map(q => q.id)
    const from = ids.indexOf(src), to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    applyOrder(ids.map((qid, i) => ({ id: qid, position: i })))
    // The block the user just moved stays selected: it is what they are working
    // on, and its band is how they would move it again.
    setActiveQuestionId(src)
  }

  const publicUrl = () => `${location.origin}/forms/public/${form?.public_token ?? ''}`

  const copyPublicLink = async () => {
    await navigator.clipboard.writeText(publicUrl())
    await confirm({ title: 'Lien copié', message: publicUrl(), confirmLabel: 'Fermer' })
  }

  /** No collaborator backend yet: sending the form is what we can offer today. */
  const shareForm = async () => {
    const url = publicUrl()
    if (navigator.share) { await navigator.share({ title: form?.title ?? 'Formulaire', url }).catch(() => {}); return }
    window.open(`mailto:?subject=${encodeURIComponent(plainText(form?.title) || 'Formulaire')}&body=${encodeURIComponent(url)}`, '_blank', 'noopener')
  }

  /** Whole-form actions offered beside the Publier button. */
  const formActions: MenuItem[] = [
    {
      type: 'action', label: 'Créer une copie', icon: <Copy size={15} />,
      onClick: () => { void formsApi.duplicate(id!).then(r => { window.location.href = `/forms/${r.data.form.id}/edit` }) },
    },
    {
      type: 'action', label: 'Préremplir le formulaire', icon: <FileInput size={15} />,
      onClick: () => window.open(`/forms/public/${form?.public_token ?? ''}?prefill=1`, '_blank', 'noopener'),
    },
    {
      type: 'action', label: 'Intégrer le code HTML', icon: <Code2 size={15} />,
      onClick: () => { void (async () => {
        const url = `${location.origin}/forms/public/${form?.public_token ?? ''}`
        await navigator.clipboard.writeText(
          `<iframe src="${url}" width="640" height="800" frameborder="0" marginheight="0" marginwidth="0">Chargement…</iframe>`)
        await confirm({ title: 'Code copié', message: "Le code d'intégration a été copié dans le presse-papiers.", confirmLabel: 'Fermer' })
      })() },
    },
    { type: 'action', label: 'Imprimer', icon: <Printer size={15} />, onClick: () => window.print() },
    { type: 'separator' },
    {
      type: 'action',
      label: form?.published_at ? 'Annuler la publication' : 'Publier le formulaire',
      icon: <Send size={15} />,
      onClick: () => { formsApi.publish(id!, !form?.published_at).then(() => qc.invalidateQueries({ queryKey: ['form', id] })) },
    },
    { type: 'separator' },
    {
      type: 'action', label: 'Placer dans la corbeille', icon: <Trash2 size={15} />, danger: true,
      onClick: () => { void (async () => {
        const ok = await confirm({
          title: 'Placer dans la corbeille ?',
          message: 'Le formulaire pourra être restauré depuis la corbeille.',
          confirmLabel: 'Placer dans la corbeille', variant: 'danger',
        })
        if (!ok) return
        await formsApi.trash(id!)
        window.location.href = '/forms'
      })() },
    },
  ]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTypingTarget(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); void history.undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); void history.redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [history])

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
      <div data-editor-header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/forms')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"><ArrowLeft size={18} /></button>
            <ClipboardList size={26} style={{ color }} />
            <input defaultValue={plainText(form.title)}
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== plainText(form.title)) debounceUpdate({ title: v }) }}
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
            <button onClick={() => setShowThemePicker(v => !v)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title="Thème" aria-label="Thème">
              <Palette size={18} />
            </button>
            <a href={`/forms/public/${form.public_token}?preview=1`} target="_blank" rel="noopener noreferrer"
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title="Aperçu" aria-label="Aperçu">
              <Eye size={18} />
            </a>
            <button onClick={() => { void history.undo() }} disabled={!history.canUndo}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 disabled:opacity-30 disabled:hover:bg-transparent"
              title="Annuler (Ctrl+Z)" aria-label="Annuler">
              <Undo2 size={18} />
            </button>
            <button onClick={() => { void history.redo() }} disabled={!history.canRedo}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 disabled:opacity-30 disabled:hover:bg-transparent"
              title="Rétablir (Ctrl+Maj+Z)" aria-label="Rétablir">
              <Redo2 size={18} />
            </button>
            <button onClick={() => { void copyPublicLink() }}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title="Copier le lien" aria-label="Copier le lien">
              <Link2 size={18} />
            </button>
            <button onClick={() => { void shareForm() }}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title="Envoyer le formulaire" aria-label="Envoyer le formulaire">
              <Share size={18} />
            </button>
            {/* Collaborators, like office's editors: people who may edit the form. */}
            <button onClick={() => { void openShare?.({
                target: { moduleId: 'forms', id: id! },
                api: {
                  list:   collaboratorsApi.listCollaborators,
                  add:    (fid, uid, p) => collaboratorsApi.addCollaborator(fid, uid, p as 'view' | 'edit'),
                  update: (fid, uid, p) => collaboratorsApi.updateCollaborator(fid, uid, p as 'view' | 'edit'),
                  remove: collaboratorsApi.removeCollaborator,
                  searchRecipients: collaboratorsApi.searchRecipients,
                },
                title: plainText(form.title) || 'Formulaire',
                permissions: ['edit', 'view'],
                permissionLabel: p => (p === 'edit' ? 'Éditeur' : 'Lecteur'),
                link: publicUrl(),
                linkAccess: {
                  label: 'Vue Éditeur',
                  value: form.settings.editorLinkAccess ?? 'restricted',
                  onChange: v => updateFormMut.mutate({
                    settings: { editorLinkAccess: v } as Parameters<typeof formsApi.update>[1]['settings'],
                  }),
                  options: [
                    { value: 'restricted', label: 'Limité', hint: "Seules les personnes avec accès peuvent l'ouvrir à l'aide du lien" },
                    { value: 'link',       label: 'Tous les utilisateurs qui ont le lien', hint: "Toute personne disposant du lien peut l'ouvrir" },
                  ],
                },
              }) }}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title="Partager avec des personnes" aria-label="Partager avec des personnes">
              <UserPlus size={18} />
            </button>
            <button onClick={() => { formsApi.publish(id!, !form.published_at).then(() => qc.invalidateQueries({ queryKey: ['form', id] })) }}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white rounded-full" style={{ backgroundColor: color }}>
              <Send size={14} /> {form.published_at ? 'Publié' : 'Publier'}
            </button>
            <button onClick={e => formMenu.open(e)} aria-label="Plus d'actions" title="Plus d'actions"
              className="w-9 h-9 flex items-center justify-center rounded-full text-gray-600 hover:bg-gray-100">
              <MoreVertical size={18} />
            </button>
            {formMenu.pos && <MenuDropdown pos={formMenu.pos} items={formActions} onClose={formMenu.close} />}
          </div>
        </div>

      </div>

      {/* Content, with the theme panel docked on its right when open. */}
      <div className="flex-1 flex min-h-0">
      <div className="flex-1 max-w-3xl mx-auto w-full py-6 px-4 relative"
        onClick={e => {
          // Ignore the click that closes a drag; it is not a click-away.
          if (Date.now() - draggedAt.current < 300) return
          // Clicking outside any question card drops the selection.
          if (!(e.target as HTMLElement).closest('[data-question-card]')) setActiveQuestionId(null)
        }}>
        {activeTab === 'questions' && (
          <div className="relative">
            {/* Vertical action rail, pinned to the right of the form column and
                following the scroll (sticky), as in the reference design. */}
            <EditorRail
              sectionIndex={focusedSection}
              color={color}
              onAddQuestion={() => createQuestionMut.mutate('multiple_choice')}
              onImport={() => setShowImport(true)}
              onAddTitle={() => createQuestionMut.mutate('statement')}
              onAddImage={() => createQuestionMut.mutate('image')}
              onAddVideo={() => createQuestionMut.mutate('video')}
              onAddSection={() => createQuestionMut.mutate('section')}
            />
            <FormHeaderImage form={form} color={color} onChanged={() => qc.invalidateQueries({ queryKey: ['form', id] })} />

            {groupIntoSections(questions).length > 1 && (
              <SectionTab index={1} total={groupIntoSections(questions).length} color={color}
                onSelect={() => setActiveQuestionId(FORM_CARD_ID)} />
            )}
            <div data-question-card
              data-section-block="0"
              className="rounded-xl overflow-hidden bg-white mb-4 transition-all"
              style={{
                ...(groupIntoSections(questions).length > 1 ? { borderTopLeftRadius: 0 } : {}),
                ...(activeQuestionId === FORM_CARD_ID
                  ? { background: `color-mix(in srgb, ${color} 6%, white)` }
                  : {}),
              }}
              onClick={() => setActiveQuestionId(FORM_CARD_ID)}>
              <div className="h-2.5 w-full" style={{ backgroundColor: color }} />
              <div className="px-6 py-5 relative">
                {groupIntoSections(questions).length > 1 && (
                  <div className="absolute top-4 right-4 z-10">
                    <SectionMenu
                      canMergeUp={false}
                      canMoveUp={false}
                      canMoveDown={groupIntoSections(questions).length > 1}
                      onDuplicate={() => { void duplicateSection(groupIntoSections(questions)[0].items) }}
                      onMoveUp={() => {}}
                      onMoveDown={() => moveSection(groupIntoSections(questions).map(g => g.items), 0, 1)}
                      onDelete={() => { void deleteSection(groupIntoSections(questions)[0].items) }}
                      onMerge={() => {}}
                    />
                  </div>
                )}
                <InlineRichField
                  value={form.title} variant="title" color={color} className="mb-4"
                  placeholder="Titre du formulaire"
                  onCommit={v => { if (v && v !== form.title) debounceUpdate({ title: v }) }} />
                <InlineRichField
                  value={form.description ?? ''} variant="description" color={color}
                  placeholder="Description du formulaire"
                  onCommit={v => { if (v !== (form.description ?? '')) debounceUpdate({ description: v || null }) }} />
              </div>
            </div>

            <div className="space-y-3">
              {groupIntoSections(questions).map((grp, gi, all) => (
                <div key={grp.key} data-section-block={gi}>
                  {/* Section 1's tab already sits on the form title card above. */}
                  {all.length > 1 && gi > 0 && (
                    <SectionTab index={gi + 1} total={all.length} color={color}
                      welded={railOut && activeQuestionId === grp.items[0]?.id}
                      onSelect={() => setActiveQuestionId(grp.items[0]?.id ?? null)} />
                  )}
                  <div className="space-y-3">
                  {grp.items.map(q => (
                <div key={q.id}
                  data-question-card
                  data-qid={q.id}>
                  <QuestionCard
                    menu={q.question_type === 'section' ? (
                      <SectionMenu
                        canMergeUp
                        canMoveUp={gi > 0}
                        canMoveDown={gi < all.length - 1}
                        onDuplicate={() => { void duplicateSection(grp.items) }}
                        onMoveUp={() => moveSection(all.map(g => g.items), gi, -1)}
                        onMoveDown={() => moveSection(all.map(g => g.items), gi, 1)}
                        onDelete={() => { void deleteSection(grp.items) }}
                        onMerge={() => { void mergeSectionUp(q) }}
                      />
                    ) : undefined}
                    question={q}
                    onDragHandle={e => startBlockDrag(e, q)}
                    isActive={activeQuestionId === q.id}
                    primaryColor={color}
                    quizMode={quizMode}
                    onClick={() => setActiveQuestionId(q.id)}
                    onUpdate={patch => patchQuestion(q.id, patch)}
                    onDelete={() => removeQuestion(q.id)}
                    onDuplicate={() => duplicateQuestionMut.mutate(q.id)}
                  />
                </div>
                  ))}
                  </div>
                  {/* Navigation after this section — the last one ends the form. */}
                  {all.length > 1 && gi < all.length - 1 && (
                    <div className="mt-3"><SectionFooter index={gi + 1} total={all.length} /></div>
                  )}
                </div>
              ))}
            </div>

          </div>
        )}

        {confirmState && (
          <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
        )}

        {/* Ghost = the dragged block's exact outline, shown over the slot it
          would land in. Same idea as the workspace Dock, but the shape is
          traced rather than boxed: a block with its band is not a rectangle. */}
      {ghost && (
        <div className="fixed inset-0 z-[100]" style={{ cursor: 'grabbing' }}>
          <BlockGhost shape={ghost} color={color} />
        </div>
      )}

      {showImport && (
          <ImportQuestionsDialog
            formId={id!} color={color}
            onClose={() => setShowImport(false)}
            onImported={() => { setShowImport(false); qc.invalidateQueries({ queryKey: ['form', id] }) }}
          />
        )}

        {activeTab === 'responses' && <ResponsesTab formId={id!} form={form} color={color} questions={questions} />}
        {activeTab === 'logic'     && <LogicEditor formId={id!} questions={questions} color={color} />}
        {activeTab === 'settings'  && <FormSettingsTab form={form} color={color} onUpdate={patch => updateFormMut.mutate({ settings: patch as Parameters<typeof formsApi.update>[1]['settings'] })} />}
      </div>

      {showThemePicker && (
        <ThemePanel
          form={form}
          onClose={() => setShowThemePicker(false)}
          onUpdate={patch => updateFormMut.mutate({ theme: { ...form.theme, ...patch } as Parameters<typeof formsApi.update>[1]['theme'] })}
          onHeaderChanged={() => qc.invalidateQueries({ queryKey: ['form', id] })}
        />
      )}
      </div>
    </div>
  )
}

// ── Sections ──────────────────────────────────────────────────────────────────

interface SectionGroup { key: string; items: Question[] }

/**
 * Split the flat question list into sections. A `section` block STARTS a new
 * section (it is its header), so everything before the first one belongs to
 * section 1.
 */
function groupIntoSections(questions: Question[]): SectionGroup[] {
  const groups: SectionGroup[] = [{ key: 'head', items: [] }]
  for (const q of questions) {
    if (q.question_type === 'section') groups.push({ key: q.id, items: [q] })
    else groups[groups.length - 1].items.push(q)
  }
  // Drop the leading group when the form opens straight on a section break.
  return groups.filter((g, i) => i > 0 || g.items.length > 0)
}

/**
 * ⋮ menu of a section header. "Fusionner avec l'élément supérieur" only exists
 * from section 2 on — section 1 has nothing above it to merge into.
 */
function SectionMenu({ canMergeUp, canMoveUp, canMoveDown, onDuplicate, onMoveUp, onMoveDown, onDelete, onMerge }: {
  canMergeUp: boolean; canMoveUp: boolean; canMoveDown: boolean
  onDuplicate: () => void; onMoveUp: () => void; onMoveDown: () => void
  onDelete: () => void; onMerge: () => void
}) {
  const menu = useMenuDropdown()
  const items: MenuItem[] = [
    { type: 'action', label: 'Dupliquer la section', icon: <Copy size={15} />, onClick: onDuplicate },
    { type: 'submenu', label: 'Déplacer la section', icon: <GripVertical size={15} />, items: [
      { type: 'action', label: 'Vers le haut', disabled: !canMoveUp,   onClick: onMoveUp },
      { type: 'action', label: 'Vers le bas',  disabled: !canMoveDown, onClick: onMoveDown },
    ] },
    { type: 'action', label: 'Supprimer la section', icon: <Trash2 size={15} />, danger: true, onClick: onDelete },
    ...(canMergeUp
      ? [{ type: 'action' as const, label: "Fusionner avec l'élément supérieur", onClick: onMerge }]
      : []),
  ]
  return (
    <>
      <button onClick={e => { e.stopPropagation(); menu.open(e) }}
        className="p-2 rounded-full hover:bg-gray-100 text-gray-500" title="Options de la section" aria-label="Options de la section">
        <MoreVertical size={18} />
      </button>
      {menu.pos && <MenuDropdown pos={menu.pos} onClose={menu.close} items={items} />}
    </>
  )
}

/** "Section 1 sur 2" tab sitting on top of the section's first card. */
/** Height of a section tab — the band overhangs by exactly this much. */
const SECTION_TAB_H = '2rem'

function SectionTab({ index, total, color, welded, onSelect }: {
  index: number; total: number; color: string
  /** The active block's band rises alongside: square that corner so they merge. */
  welded?: boolean
  /** Selects the section header the tab belongs to. */
  onSelect?: () => void
}) {
  return (
    <div className="flex">
      {/* Kept a span rather than a button: it reads as part of the block, and a
          real button would be flattened by the project-wide no-bold rule. */}
      <span data-section-tab role="button" tabIndex={0}
        onClick={e => { e.stopPropagation(); onSelect?.() }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.() } }}
        className="px-4 rounded-t-lg text-xs font-medium text-white flex items-center cursor-pointer select-none"
        style={{
          backgroundColor: color,
          height: SECTION_TAB_H,
          ...(welded ? { borderTopLeftRadius: 0 } : {}),
        }}>
        Section {index} sur {total}
      </span>
    </div>
  )
}

/** "Après la section N — [what happens next]" row, shown between sections. */
function SectionFooter({ index, total }: { index: number; total: number }) {
  const [action, setAction] = useState('next')
  const options = [
    { value: 'next',   label: 'Passer à la section suivante' },
    { value: 'submit', label: 'Envoyer le formulaire' },
    ...Array.from({ length: total }, (_, i) => ({
      value: `goto-${i + 1}`,
      label: `Passer à la section ${i + 1}`,
    })).filter(o => o.value !== `goto-${index}`),
  ]
  return (
    <div className="flex items-center gap-3 pl-1 pt-1">
      <span className="text-sm text-gray-600 whitespace-nowrap">Après la section {index}</span>
      <Dropdown value={action} onChange={setAction} options={options} height={34} fontSize={14} width={260} />
    </div>
  )
}

// ── Import questions from another form ─────────────────────────────────────────

/**
 * Two-step picker: choose one of the user's OTHER forms, then tick the questions
 * to copy. The copy itself is done server-side (both forms ownership-checked).
 */
function ImportQuestionsDialog({ formId, color, onClose, onImported }: {
  formId: string; color: string; onClose: () => void; onImported: () => void
}) {
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [picked, setPicked]     = useState<Set<string>>(new Set())
  const [busy, setBusy]         = useState(false)

  const { data: formsData } = useQuery({
    queryKey: ['forms', 'import-source'],
    queryFn:  () => formsApi.list().then(r => r.data),
  })
  const sources = (formsData?.forms ?? []).filter(f => f.id !== formId)

  const { data: qData, isLoading: loadingQ } = useQuery({
    queryKey: ['questions', sourceId],
    queryFn:  () => formsApi.listQuestions(sourceId!).then(r => r.data),
    enabled:  !!sourceId,
  })
  const questions = qData?.questions ?? []

  const toggle = (qid: string) =>
    setPicked(prev => { const next = new Set(prev); next.has(qid) ? next.delete(qid) : next.add(qid); return next })

  const run = async () => {
    if (!sourceId || picked.size === 0) return
    setBusy(true)
    try {
      // Keep the source order rather than the click order.
      const ordered = questions.filter(q => picked.has(q.id)).map(q => q.id)
      await formsApi.importQuestions(formId, sourceId, ordered)
      onImported()
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[80vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-medium text-gray-800">Importer des questions</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!sourceId ? (
            sources.length === 0 ? (
              <p className="text-sm text-gray-500">Aucun autre formulaire à importer.</p>
            ) : (
              <ul className="space-y-1">
                {sources.map(f => (
                  <li key={f.id}>
                    <button onClick={() => { setSourceId(f.id); setPicked(new Set()) }}
                      className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-800 hover:bg-gray-50 flex items-center gap-3">
                      <ClipboardList size={16} className="text-gray-400 shrink-0" />
                      <span className="flex-1 truncate">{plainText(f.title)}</span>
                      <span className="text-xs text-gray-400">
                        {f.response_count > 0 ? `${f.response_count} réponse${f.response_count > 1 ? 's' : ''}` : 'Aucune réponse'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : loadingQ ? (
            <p className="text-sm text-gray-500">Chargement des questions…</p>
          ) : questions.length === 0 ? (
            <p className="text-sm text-gray-500">Ce formulaire ne contient aucune question.</p>
          ) : (
            <ul className="space-y-1">
              {questions.map(q => {
                const meta = getMeta(q.question_type)
                return (
                  <li key={q.id}>
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-800 hover:bg-gray-50">
                      <Checkbox checked={picked.has(q.id)} onChange={() => toggle(q.id)} />
                      <meta.Icon size={15} className="text-gray-400 shrink-0" />
                      <span className="flex-1 truncate">{q.title || 'Question sans titre'}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-gray-200">
          {sourceId
            ? <button onClick={() => setSourceId(null)} className="text-sm text-gray-600 hover:text-gray-800">← Changer de formulaire</button>
            : <span />}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button variant="primary" onClick={() => { void run() }} loading={busy}
              disabled={!sourceId || picked.size === 0}>
              Importer{picked.size > 0 ? ` (${picked.size})` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Editor action rail ─────────────────────────────────────────────────────────

/**
 * Floating vertical toolbar sitting to the right of the form column. `sticky`
 * keeps it in view while the user scrolls through a long form; it is absolutely
 * positioned so it never steals width from the form itself.
 */
function EditorRail({ color, sectionIndex, onAddQuestion, onImport, onAddTitle, onAddImage, onAddVideo, onAddSection }: {
  color: string
  /** Section the rail is bound to: it never leaves that section vertically. */
  sectionIndex: number
  onAddQuestion: () => void; onImport: () => void; onAddTitle: () => void
  onAddImage: () => void; onAddVideo: () => void; onAddSection: () => void
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)

  // The rail follows the scroll, but its top and bottom are clamped to the
  // focused section: it never floats over a section it does not act on.
  useEffect(() => {
    const place = () => {
      const rail = railRef.current
      const host = rail?.offsetParent as HTMLElement | null
      if (!rail || !host) return
      const blocks = [...document.querySelectorAll(`[data-section-block="${sectionIndex}"]`)]
      if (blocks.length === 0) return
      const rects   = blocks.map(b => b.getBoundingClientRect())
      const hostTop = host.getBoundingClientRect().top
      const secTop  = Math.min(...rects.map(r => r.top))    - hostTop
      const secBot  = Math.max(...rects.map(r => r.bottom)) - hostTop
      // Anchor under the editor's sticky header — a hardcoded offset let the
      // rail slide under it and get clipped.
      const header  = document.querySelector('[data-editor-header]')
      const headerBottom = header ? header.getBoundingClientRect().bottom : 0
      const wanted  = headerBottom + 16 - hostTop
      const maxTop  = Math.max(secTop, secBot - rail.offsetHeight)
      setTop(Math.min(Math.max(wanted, secTop), maxTop))
    }
    place()
    // Listen in the CAPTURE phase at document level: scroll does not bubble, and
    // resolving "the" scroll container at mount is unreliable (the content is
    // not laid out yet, so no ancestor looks scrollable and we fell back to
    // window — which never scrolls here). This catches whichever element moves.
    document.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    const obs = new ResizeObserver(place)
    document.querySelectorAll(`[data-section-block="${sectionIndex}"]`).forEach(b => obs.observe(b))
    return () => {
      document.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      obs.disconnect()
    }
  }, [sectionIndex])
  const tools = [
    { label: 'Ajouter une question',            Icon: CirclePlus, onClick: onAddQuestion },
    { label: 'Importer des questions',          Icon: FileInput,  onClick: onImport },
    { label: 'Ajouter un titre et une description', Icon: TypeIcon, onClick: onAddTitle },
    { label: 'Ajouter une image',               Icon: ImageIcon,  onClick: onAddImage },
    { label: 'Ajouter une vidéo',               Icon: Video,      onClick: onAddVideo },
    { label: 'Ajouter une section',             Icon: Rows3,      onClick: onAddSection },
  ]
  return (
    <div ref={railRef} data-rail-section={sectionIndex} className="absolute left-full ml-4 hidden lg:block" style={{ top }}>
      <div className="flex flex-col items-center gap-1 bg-white rounded-full shadow-md border border-gray-200 py-2 px-1">
        {tools.map(t => (
          <Tooltip key={t.label} label={t.label} side="right">
            <button type="button" aria-label={t.label} onClick={t.onClick}
              className="w-9 h-9 flex items-center justify-center rounded-full text-gray-600 transition-colors"
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = `color-mix(in srgb, ${color} 12%, white)` }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = '' }}>
              <t.Icon size={19} />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

// ── Form header image (banner) ─────────────────────────────────────────────────

/**
 * Banner at the top of the form. Without an image it is the flat theme-coloured
 * strip; with one it becomes a cover image. Clicking it reveals a small floating
 * toolbar (replace, edit, delete) anchored at its bottom-left.
 */
function FormHeaderImage({ form, color, onChanged }: {
  form: Form; color: string; onChanged: () => void
}) {
  const [selected, setSelected] = useState(false)
  const [busy, setBusy]         = useState(false)
  // Cache-buster: the banner URL is stable, so a replacement would otherwise
  // keep showing the previous image.
  const [bust, setBust]         = useState<string | null>(null)
  const [editing, setEditing]   = useState(false)
  const bannerRef               = useRef<HTMLDivElement>(null)

  const hasImage = !!form.header_image_path
  const src      = hasImage ? formsApi.headerImageUrl(form.public_token, bust ?? form.updated_at) : null

  const pick = () => { void pickImageFile({ title: "Image d'en-tête" }).then(onFile) }

  const onFile = async (file: File | null | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      await formsApi.uploadHeader(form.id, file)
      setBust(String(Date.now()))
      onChanged()
    } finally { setBusy(false) }
  }

  const remove = async () => {
    setBusy(true)
    try { await formsApi.deleteHeader(form.id); onChanged() } finally { setBusy(false) }
  }

  // The banner is a block of its own, detached from the title card below it —
  // it is form-level decoration, not part of the title.
  return (
    <div className={`relative ${hasImage ? 'mb-8' : 'mb-4'}`}>
      <div
        ref={bannerRef}
        onClick={() => setSelected(v => !v)}
        title={hasImage ? "Cliquez pour modifier l'en-tête" : "Cliquez pour ajouter une image d'en-tête"}
        className={`w-full cursor-pointer transition-all rounded-xl overflow-hidden ${hasImage ? 'h-40' : 'h-10'} ${selected ? 'ring-2 ring-inset' : ''}`}
        style={{
          backgroundColor: color,
          ...(src ? { backgroundImage: `url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
          ...(selected ? { boxShadow: `inset 0 0 0 2px ${color}` } : {}),
        }}
      />

      {selected && (
        <>
          {/* Click-away layer: the toolbar closes like a menu. */}
          <div className="fixed inset-0 z-20" onClick={() => setSelected(false)} />
          <div className="absolute left-3 -bottom-4 z-30 flex items-center gap-1 bg-white rounded-full shadow-lg border border-gray-200 px-1.5 py-1"
            onClick={e => e.stopPropagation()}>
            <HeaderTool label={hasImage ? "Remplacer l'image d'en-tête" : "Ajouter une image d'en-tête"}
              onClick={pick} disabled={busy}>
              <ImagePlus size={16} />
            </HeaderTool>
            {hasImage && (
              <>
                <HeaderTool label="Modifier l'image d'en-tête"
                  onClick={() => { setEditing(true); setSelected(false) }} disabled={busy}>
                  <SlidersHorizontal size={16} />
                </HeaderTool>
                <span className="w-px h-5 bg-gray-200" />
                <HeaderTool label="Supprimer l'image d'en-tête" onClick={() => { void remove() }} disabled={busy} danger>
                  <Trash2 size={16} />
                </HeaderTool>
              </>
            )}
          </div>
        </>
      )}

      {editing && src && (
        <HeaderImageEditor
          src={src}
          // The frame is locked to the proportions the banner is drawn at.
          aspect={(bannerRef.current?.clientWidth ?? 736) / (bannerRef.current?.clientHeight ?? 160)}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={file => { setEditing(false); void onFile(file) }}
        />
      )}
    </div>
  )
}

function HeaderTool({ label, onClick, disabled, danger, children }: {
  label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode
}) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors disabled:opacity-40
        ${danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-600 hover:bg-gray-100'}`}>
      {children}
    </button>
  )
}

// ── Theme panel ────────────────────────────────────────────────────────────────


/**
 * True while the viewport is too narrow for a rail sitting OUTSIDE the block.
 *
 * Deliberately measured in JS: a module's `sm:`/`lg:` utilities land in the
 * `kubuno-module` cascade layer and lose against the host's `utilities`, so a
 * Tailwind breakpoint would silently never apply here.
 */
function useRoomForRail(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 950px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 950px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

/**
 * Actions of the active block, in a band WELDED to its left edge: same height,
 * rounded on the outer side only and squared on the inner one, so it reads as
 * an extension of the card rather than a floating toolbar. The tools sit at the
 * bottom of the band, where they used to live inside the block.
 *
 * Below the breakpoint there is no room outside the card, so the same actions
 * fold back INTO the block as a horizontal bar.
 */
function BlockRail({ color, overhang, onDragHandle, onDuplicate, onDelete }: {
  color: string
  /** Rises above the card by this much, to meet a section tab sitting on top. */
  overhang?: string
  /** Pointer-down on the grip: starts dragging the block. */
  onDragHandle?: (e: React.PointerEvent) => void
  /** Omitted where duplicating makes no sense — a section, for one. */
  onDuplicate?: () => void
  onDelete: () => void
}) {
  const wide = useRoomForRail()

  /** On the coloured band the icons go white; folded back inside, they stay grey. */
  const Tool = ({ label, danger, onClick, children }: {
    label: string; danger?: boolean; onClick?: () => void; children: React.ReactNode
  }) => (
    <button type="button" title={label} aria-label={label} onClick={onClick}
      className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
        wide
          ? 'text-white/90 hover:text-white hover:bg-white/20'
          : danger ? 'text-gray-500 hover:text-red-600 hover:bg-red-50' : 'text-gray-500 hover:bg-black/5'
      }`}>
      {children}
    </button>
  )

  if (!wide) {
    return (
      <div className="flex flex-row items-center gap-0.5 px-6 pb-3" onClick={e => e.stopPropagation()}>
        <span title="Déplacer" aria-label="Déplacer" onPointerDown={onDragHandle}
          className="w-8 h-8 flex items-center justify-center text-gray-400 cursor-grab touch-none">
          <GripVertical size={16} />
        </span>
        <span className="w-px h-4 bg-gray-200 mx-1" />
        {onDuplicate && <Tool label="Dupliquer" onClick={onDuplicate}><Copy size={16} /></Tool>}
        <Tool label="Supprimer" danger onClick={onDelete}><Trash2 size={16} /></Tool>
      </div>
    )
  }

  return (
    // One column welded to the card's left edge: a head as tall as its tools,
    // then a thin spine. `right-full` leaves no gap to fall through.
    <div data-block-rail className="absolute right-full bottom-0 w-11 flex flex-col"
      style={{ top: overhang ? `-${overhang}` : 0 }}>
      <div
        data-rail-head
        className="w-full flex flex-col items-center gap-0.5 py-3"
        style={{
          background: color,
          borderTopLeftRadius: 'var(--radius-xl, 12px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* The handle leads: it is what the block is grabbed by. */}
        <span title="Déplacer" aria-label="Déplacer" onPointerDown={onDragHandle}
          className="w-8 h-8 flex items-center justify-center text-white/90 cursor-grab touch-none">
          <GripVertical size={16} />
        </span>
        <span className="w-4 h-px bg-white/30 my-0.5" />
        {onDuplicate && <Tool label="Dupliquer" onClick={onDuplicate}><Copy size={16} /></Tool>}
        <Tool label="Supprimer" danger onClick={onDelete}><Trash2 size={16} /></Tool>
      </div>

      {/* S-curve down to the spine, in two tangent quarter-circles of 16px:
          first CONVEX, rounding the head's bottom corner (vertical tangent at
          the top), then CONCAVE, landing flush on the spine (vertical tangent
          at the bottom). A single arc would meet the head's vertical edge with
          a horizontal tangent — the sharp corner this replaces. Together they
          give up 44px − 12px = 32px of width over 32px of height. */}
      <div
        className="w-full h-4 shrink-0"
        style={{ background: color, borderBottomLeftRadius: '1rem' }}
        aria-hidden
      />
      <div
        className="w-7 h-4 shrink-0 self-end"
        style={{
          background:
            `radial-gradient(circle at 0 100%, transparent 0 calc(1rem - 0.5px), ${color} 1rem)`,
        }}
        aria-hidden
      />

      {/* Thin spine: keeps the block flagged for its whole height without a
          wide slab of colour where there is nothing to click. */}
      <div
        className="w-3 flex-1 self-end"
        style={{ background: color, borderBottomLeftRadius: 'var(--radius-xl, 12px)' }}
        aria-hidden
      />
    </div>
  )
}

/**
 * Nearest ancestor that actually scrolls, or null for the window.
 *
 * Resolved at drag start rather than cached: the editor lives inside the host
 * shell, so whether the list scrolls in a container or in the page depends on
 * where the module is mounted.
 */
function findScroller(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n
  }
  return null
}

/** Visible band of the scrolling area, in viewport coordinates. */
function scrollViewport(sc: HTMLElement | null): { top: number; bottom: number } {
  if (!sc) return { top: 0, bottom: window.innerHeight }
  const r = sc.getBoundingClientRect()
  return { top: r.top, bottom: r.bottom }
}

function scrollTopOf(sc: HTMLElement | null): number {
  return sc ? sc.scrollTop : window.scrollY
}

function scrollByY(sc: HTMLElement | null, dy: number): void {
  if (sc) sc.scrollTop += dy
  else window.scrollBy(0, dy)
}

// ── Question card ───────────────────────────────────────────────────────────────

function QuestionCard({ question, isActive, primaryColor, quizMode, onClick, onUpdate, onDelete, onDuplicate, onDragHandle, menu }: {
  question: Question; isActive: boolean; primaryColor: string; quizMode: boolean
  onClick: () => void; onUpdate: (p: Partial<Question>) => void; onDelete: () => void; onDuplicate: () => void
  onDragHandle?: (e: React.PointerEvent) => void
  /** Section-level ⋮ menu, only for a `section` block. */
  menu?: React.ReactNode
}) {
  const typeMenu = useMenuDropdown()
  const meta     = getMeta(question.question_type)
  // Called unconditionally: `isActive && useRoomForRail()` would short-circuit
  // the hook and break the hook order across renders.
  const wide     = useRoomForRail()
  // When the band is welded on the left, the card squares that edge so the two
  // merge into one shape instead of showing a notch at each corner.
  const squareLeft = isActive && wide
    ? { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }
    : {}

  if (question.question_type === 'section') {
    return (
      // The section tab sits on this corner: square it so the two merge.
      <div className={'relative rounded-xl bg-white transition-all'}
        style={{
          borderTopLeftRadius: 0,
          ...squareLeft,
          ...(isActive ? { background: `color-mix(in srgb, ${primaryColor} 6%, white)` } : {}),
        }}
        onClick={onClick}>
        {isActive && <BlockRail color={primaryColor} overhang={SECTION_TAB_H} onDragHandle={onDragHandle} onDelete={onDelete} />}
        <div className="px-6 py-5 relative">
          {menu && <div className="absolute top-4 right-4 z-10">{menu}</div>}
          <InlineRichField
            value={question.title} variant="subtitle" color={primaryColor} className="mb-3"
            placeholder="Section sans titre"
            onCommit={v => { if (v !== question.title) onUpdate({ title: v }) }} />
          <InlineRichField
            value={(question.description as string) ?? ''} variant="description" color={primaryColor}
            placeholder="Description (facultative)"
            onCommit={v => { if (v !== ((question.description as string) ?? '')) onUpdate({ description: v || null }) }} />
        </div>
      </div>
    )
  }

  return (
    <div className={'relative rounded-xl bg-white transition-all'}
      style={{
        ...squareLeft,
        ...(isActive ? { background: `color-mix(in srgb, ${primaryColor} 6%, white)` } : {}),
      }} onClick={onClick}>
      {isActive && <BlockRail color={primaryColor} onDragHandle={onDragHandle} onDuplicate={onDuplicate} onDelete={onDelete} />}
      <div className="p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1">
            {isActive ? (
              <InlineRichField
                value={question.title} variant="description" color={primaryColor}
                placeholder="Question sans titre"
                className="bg-gray-50 px-2 py-1 rounded-t [&>div>div[contenteditable]]:text-base [&>div>div[contenteditable]]:text-gray-800"
                onCommit={v => { if (v && v !== question.title) onUpdate({ title: v }) }} />
            ) : (
              <div className="text-base text-gray-800 flex items-center gap-2">
                <meta.Icon size={15} className="text-gray-400" />
                {question.title
                  ? <span dangerouslySetInnerHTML={{ __html: question.title }} />
                  : <span className="text-gray-400">Question sans titre</span>}
                {question.required && <span className="text-red-500">*</span>}
                {quizMode && meta.supportsQuiz && question.points > 0 && (
                  <span className="text-xs text-gray-400 inline-flex items-center gap-0.5"><Trophy size={11} /> {question.points}</span>
                )}
              </div>
            )}
          </div>

          {isActive && (
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button onClick={e => typeMenu.open(e)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:border-gray-400 text-gray-700">
                <meta.Icon size={15} /> {meta.label} <ChevronDown size={14} />
              </button>
              {typeMenu.pos && (
                <MenuDropdown
                  pos={typeMenu.pos}
                  onClose={typeMenu.close}
                  items={QUESTION_TYPES.map(t => ({
                    type: 'action' as const,
                    label:   t.label,
                    icon:    <t.Icon size={15} />,
                    checked: question.question_type === t.value,
                    onClick: () => {
                      // Reset options to the new type's defaults when switching kind.
                      const patch: Partial<Question> = { question_type: t.value }
                      if (t.value !== question.question_type) patch.options = defaultOptionsFor(t.value)
                      onUpdate(patch)
                    },
                  }))}
                />
              )}
            </div>
          )}
        </div>

        {isActive && (
          <div className="mb-4" onClick={e => e.stopPropagation()}>
            <InlineRichField
              value={question.description ?? ''} variant="description" color={primaryColor} className="mb-3"
              placeholder="Description (facultatif)"
              onCommit={v => { if (v !== (question.description ?? '')) onUpdate({ description: v || null }) }} />
          </div>
        )}

        {isActive
          ? <div onClick={e => e.stopPropagation()}><OptionsEditor question={question} color={primaryColor} quizMode={quizMode} onUpdate={onUpdate} /></div>
          : <QuestionPreview question={question} />}
      </div>

      {isActive && !isContentType(question.question_type) && (
        <div className="flex items-center justify-end px-6 py-3 border-t border-gray-100" onClick={e => e.stopPropagation()}>
          <Toggle
            label="Requis"
            checked={question.required}
            onChange={e => onUpdate({ required: e.target.checked })}
          />
        </div>
      )}
    </div>
  )
}

function QuestionPreview({ question }: { question: Question }) {
  const opts = (question.options?.options as Array<{ id: string; label: string }>) ?? []
  switch (question.question_type) {
    case 'video':
      return <VideoBlock options={question.options} title={question.title} />
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
  const qc   = useQueryClient()
  const menu = useMenuDropdown()
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()
  const { prefs, update: updatePrefs } = useModulePrefs<FormsNotifyPrefs>('forms', { notifyOnReply: false })
  const { data: analyticsData } = useQuery({ queryKey: ['forms-analytics', formId], queryFn: () => formsApi.analytics(formId).then(r => r.data) })
  const { data: statsData } = useQuery({ queryKey: ['forms-stats', formId], queryFn: () => formsApi.questionStats(formId).then(r => r.data.stats), enabled: view === 'summary' })

  const total = analyticsData?.total_responses ?? form.response_count

  const responseMenu: MenuItem[] = [
    {
      type: 'action',
      label: 'Recevoir une notification lorsqu\'une réponse est ajoutée',
      icon: prefs.notifyOnReply ? <BellRing size={15} /> : <Bell size={15} />,
      onClick: () => { void updatePrefs({ notifyOnReply: !prefs.notifyOnReply }) },
    },
    { type: 'separator' },
    {
      type: 'action', label: 'Télécharger les réponses (.csv)', icon: <Download size={15} />,
      disabled: total === 0,
      onClick: () => window.open(formsApi.exportCsvUrl(formId), '_blank', 'noopener'),
    },
    {
      type: 'action', label: 'Imprimer toutes les réponses', icon: <Printer size={15} />,
      disabled: total === 0,
      onClick: () => window.print(),
    },
    { type: 'separator' },
    {
      type: 'action', label: 'Supprimer toutes les réponses', icon: <Trash2 size={15} />, danger: true,
      disabled: total === 0,
      onClick: () => { void (async () => {
        const ok = await confirm({
          title: 'Supprimer toutes les réponses ?',
          message: 'Les ' + total + ' réponses seront définitivement effacées.',
          confirmLabel: 'Supprimer', variant: 'danger',
        })
        if (!ok) return
        await formsApi.deleteAllResponses(formId)
        qc.invalidateQueries({ queryKey: ['forms-analytics', formId] })
        qc.invalidateQueries({ queryKey: ['forms-stats', formId] })
        qc.invalidateQueries({ queryKey: ['form', formId] })
      })() },
    },
  ]

  return (
    <div className="space-y-4">
      {/* Header: the count, then the actions that apply to the whole set. */}
      <div className="bg-white rounded-xl p-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-3xl font-light text-gray-800">
            {total} réponse{total !== 1 ? 's' : ''}
          </div>
          {!!analyticsData?.avg_fill_duration_secs && (
            <div className="text-sm text-gray-400 mt-1">
              Durée moyenne : {Math.round(analyticsData.avg_fill_duration_secs)}s
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip label="Ouvre les réponses dans un nouveau tableur">
            <a href={formsApi.exportCsvUrl(formId)} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 h-9 rounded-lg text-xs hover:bg-surface-1 transition-colors"
              style={{ color }}>
              <Table2 size={16} /> Vers un tableur
            </a>
          </Tooltip>
          <button onClick={e => menu.open(e)} aria-label="Plus d'actions" title="Plus d'actions"
            className="w-9 h-9 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">
            <MoreVertical size={18} />
          </button>
          {menu.pos && <MenuDropdown pos={menu.pos} items={responseMenu} onClose={menu.close} />}
          {confirmState && (
            <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
          )}
        </div>
      </div>

      <div className="flex gap-2">
        {(['summary', 'individual'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${view === v ? 'text-white border-transparent' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            style={view === v ? { backgroundColor: color, borderColor: color } : {}}>
            {v === 'summary' ? 'Résumé' : 'Individuel'}
          </button>
        ))}
      </div>

      {total === 0 && (
        <div className="bg-white rounded-xl p-8 text-center text-xs text-gray-500">
          Aucune réponse. {form.published_at ? 'Partagez votre formulaire' : 'Publiez votre formulaire'} pour commencer à en recevoir.
        </div>
      )}

      {view === 'summary' && statsData?.map(stat => (
        <div key={stat.question_id} className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-base text-gray-800 mb-1">{plainText(stat.title)}</div>
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

