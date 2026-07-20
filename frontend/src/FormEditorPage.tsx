import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Eye, Send, Trash2, Copy, GripVertical, ChevronDown,
  ArrowLeft, BarChart2, ClipboardList,
  Trophy, Star, Heart, Check,
  ImagePlus, ImageIcon, RefreshCw, CirclePlus, FileInput, Type as TypeIcon,
  Video, Rows3, X, Undo2, Redo2, MoreVertical,
} from 'lucide-react'
import { formsApi, type Form, type Question, type QuestionType } from './api'
import { plainText } from './plainText'
import { pickImageFile } from './imagePicker'
import { DatePicker, Dropdown, Button, Checkbox, MenuDropdown, useMenuDropdown, Toggle, ConfirmDialog, type MenuItem } from '@ui'
import { useConfirm } from '@kubuno/sdk'
import {
  QUESTION_TYPES, getMeta, defaultOptionsFor, isContentType,
} from './questionTypes'
import OptionsEditor from './OptionsEditor'
import VideoBlock from './VideoBlock'
import { Tooltip } from './Tooltip'
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
  const [showImport, setShowImport]             = useState(false)
  const [showThemePicker, setShowThemePicker]   = useState(false)
  const dragId = useRef<string | null>(null)

  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: ['form', id] }) }, [qc, id])
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()
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
      if (Object.keys(opts).length) await formsApi.updateQuestion(id!, q.id, { options: opts })
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
  }

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
      <div className="flex-1 max-w-3xl mx-auto w-full py-6 px-4 relative"
        onClick={e => {
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
              <SectionTab index={1} total={groupIntoSections(questions).length} color={color} />
            )}
            <div data-question-card
              data-section-block="0"
              className="rounded-xl overflow-hidden bg-white shadow-sm mb-4 transition-all"
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
                  <div className="absolute top-4 right-4">
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
                    <SectionTab index={gi + 1} total={all.length} color={color} />
                  )}
                  <div className="space-y-3">
                  {grp.items.map(q => (
                <div key={q.id}
                  data-question-card
                  draggable
                  onDragStart={() => { dragId.current = q.id }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => onDrop(q.id)}>
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

        {showImport && (
          <ImportQuestionsDialog
            formId={id!} color={color}
            onClose={() => setShowImport(false)}
            onImported={() => { setShowImport(false); qc.invalidateQueries({ queryKey: ['form', id] }) }}
          />
        )}

        {activeTab === 'responses' && <ResponsesTab formId={id!} form={form} color={color} questions={questions} />}
        {activeTab === 'logic'     && <LogicEditor formId={id!} questions={questions} color={color} />}
        {activeTab === 'settings'  && <SettingsTab form={form} color={color} onUpdate={patch => updateFormMut.mutate({ settings: patch as Parameters<typeof formsApi.update>[1]['settings'] })} />}
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
function SectionTab({ index, total, color }: { index: number; total: number; color: string }) {
  return (
    <div className="flex">
      <span className="px-4 py-1.5 rounded-t-lg text-sm font-medium text-white"
        style={{ backgroundColor: color }}>
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
 * toolbar (add/replace, delete) anchored at its bottom-left, as in the mock-up.
 */
function FormHeaderImage({ form, color, onChanged }: {
  form: Form; color: string; onChanged: () => void
}) {
  const [selected, setSelected] = useState(false)
  const [busy, setBusy]         = useState(false)
  // Cache-buster: the banner URL is stable, so a replacement would otherwise
  // keep showing the previous image.
  const [bust, setBust]         = useState<string | null>(null)

  const hasImage = !!form.header_image_path
  const src      = hasImage ? formsApi.headerImageUrl(form.public_token, bust ?? form.updated_at) : null

  const pick = () => { void pickImageFile("Image d'en-tête").then(onFile) }

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
        onClick={() => setSelected(v => !v)}
        title={hasImage ? "Cliquez pour modifier l'en-tête" : "Cliquez pour ajouter une image d'en-tête"}
        className={`w-full cursor-pointer transition-all rounded-xl overflow-hidden shadow-sm ${hasImage ? 'h-40' : 'h-10'} ${selected ? 'ring-2 ring-inset' : ''}`}
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
            <HeaderTool label={hasImage ? "Remplacer l'image" : "Ajouter une image"} onClick={pick} disabled={busy}>
              {hasImage ? <RefreshCw size={16} /> : <ImagePlus size={16} />}
            </HeaderTool>
            {hasImage && (
              <>
                <HeaderTool label="Choisir une autre image" onClick={pick} disabled={busy}>
                  <ImageIcon size={16} />
                </HeaderTool>
                <span className="w-px h-5 bg-gray-200" />
                <HeaderTool label="Supprimer l'image" onClick={() => { void remove() }} disabled={busy} danger>
                  <Trash2 size={16} />
                </HeaderTool>
              </>
            )}
          </div>
        </>
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
      <div className="mb-2">
        <Dropdown value={form.theme.fontFamily} width="100%" height={34} fontSize={14}
          options={FONTS.map(f => ({ value: f.value, label: f.label }))}
          onChange={v => onUpdate({ theme: { ...form.theme, fontFamily: v } as Parameters<typeof formsApi.update>[1]['theme'] })} />
      </div>
      <button onClick={onClose} className="w-full mt-2 text-sm text-gray-500 hover:text-gray-700">Fermer</button>
    </div>
  )
}

// ── Question card ───────────────────────────────────────────────────────────────

function QuestionCard({ question, isActive, primaryColor, quizMode, onClick, onUpdate, onDelete, onDuplicate, menu }: {
  question: Question; isActive: boolean; primaryColor: string; quizMode: boolean
  onClick: () => void; onUpdate: (p: Partial<Question>) => void; onDelete: () => void; onDuplicate: () => void
  /** Section-level ⋮ menu, only for a `section` block. */
  menu?: React.ReactNode
}) {
  const typeMenu = useMenuDropdown()
  const meta     = getMeta(question.question_type)

  if (question.question_type === 'section') {
    return (
      // The section tab sits on this corner: square it so the two merge.
      <div className={`rounded-xl bg-white shadow-sm transition-all ${isActive ? 'shadow-md' : 'hover:shadow-md'}`}
        style={{
          borderTopLeftRadius: 0,
          ...(isActive ? { background: `color-mix(in srgb, ${primaryColor} 6%, white)` } : {}),
        }}
        onClick={onClick}>
        <div className="px-6 py-5 relative">
          {menu && <div className="absolute top-4 right-4">{menu}</div>}
          <InlineRichField
            value={question.title} variant="subtitle" color={primaryColor} className="mb-3"
            placeholder="Section sans titre"
            onCommit={v => { if (v !== question.title) onUpdate({ title: v }) }} />
          <InlineRichField
            value={(question.description as string) ?? ''} variant="description" color={primaryColor}
            placeholder="Description (facultative)"
            onCommit={v => { if (v !== ((question.description as string) ?? '')) onUpdate({ description: v || null }) }} />
        </div>
        {isActive && (
          <div className="flex items-center gap-1 px-6 pb-4" onClick={e => e.stopPropagation()}>
            <button onClick={onDuplicate} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title="Dupliquer"><Copy size={18} /></button>
            <button onClick={onDelete} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title="Supprimer"><Trash2 size={18} /></button>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <GripVertical size={16} className="text-gray-400 cursor-grab" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`rounded-xl bg-white shadow-sm transition-all ${isActive ? 'shadow-md' : 'hover:shadow-md'}`}
      style={isActive ? { background: `color-mix(in srgb, ${primaryColor} 6%, white)` } : {}} onClick={onClick}>
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

      {isActive && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <button onClick={onDuplicate} className="p-1.5 rounded text-gray-500 hover:bg-gray-100" title="Dupliquer"><Copy size={16} /></button>
            <button onClick={onDelete} className="p-1.5 rounded text-gray-500 hover:text-red-500 hover:bg-red-50" title="Supprimer"><Trash2 size={16} /></button>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <GripVertical size={16} className="text-gray-400 cursor-grab" />
          </div>
          {!isContentType(question.question_type) && (
            <Toggle
              label="Requis"
              checked={question.required}
              onChange={e => onUpdate({ required: e.target.checked })}
            />
          )}
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
        <SettingToggle label="Afficher la barre de progression" value={s.showProgressBar} onChange={v => onUpdate({ showProgressBar: v })} />
      </div>

      {/* Quiz */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <div className="flex items-center gap-2"><Trophy size={18} style={{ color }} /><h3 className="text-base font-medium text-gray-800">Mode quiz</h3></div>
        <SettingToggle label="Activer le quiz (points et bonnes réponses)" value={!!s.quizMode} onChange={v => onUpdate({ quizMode: v })} />
        {s.quizMode && <SettingToggle label="Afficher le score immédiatement au répondant" value={s.showResultImmediately ?? true} onChange={v => onUpdate({ showResultImmediately: v })} />}
      </div>

      {/* Réponses */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <h3 className="text-base font-medium text-gray-800">Réponses</h3>
        <SettingToggle label="Collecter les adresses e-mail" value={s.collectEmail} onChange={v => onUpdate({ collectEmail: v })} />
        <SettingToggle label="Limiter à une réponse par personne" value={s.limitToOneResponse} onChange={v => onUpdate({ limitToOneResponse: v })} />
        <SettingToggle label="Accepter les réponses" value={s.acceptingResponses} onChange={v => onUpdate({ acceptingResponses: v })} />

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

function SettingToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="py-1">
      <Toggle label={label} checked={value} onChange={e => onChange(e.target.checked)} />
    </div>
  )
}
