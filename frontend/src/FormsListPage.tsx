import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Plus, MoreVertical, Trash2, RotateCcw, Copy, Clock,
  Grid, List, ClipboardList, MessageSquare, Star, Layers,
} from 'lucide-react'
import { Button, MenuDropdown, type MenuDropdownPos } from '@ui'
import { formsApi, type FormSummary } from './api'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

const FORM_COLORS = [
  '#673ab7', '#db4437', '#e91e63', '#3f51b5',
  '#1a73e8', '#009688', '#4caf50', '#ff9800',
]

const TEMPLATES = [
  { id: 'contact',    label: 'Contact',       icon: MessageSquare, color: '#1a73e8' },
  { id: 'feedback',   label: 'Retour',        icon: Star,          color: '#ff9800' },
  { id: 'survey',     label: 'Sondage',       icon: ClipboardList, color: '#673ab7' },
  { id: 'quiz',       label: 'Quiz',          icon: Layers,        color: '#009688' },
]

export default function FormsListPage({ trashed }: { trashed?: boolean }) {
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const [view, setView]     = useState<'grid' | 'list'>('grid')

  const { data, isLoading } = useQuery({
    queryKey: ['forms', { trashed }],
    queryFn:  () => formsApi.list({ trashed }).then(r => r.data.forms),
  })

  const createMut = useMutation({
    mutationFn: () => formsApi.create({}),
    onSuccess:  (r) => navigate(`/forms/${r.data.form.id}/edit`),
  })

  const duplicateMut = useMutation({
    mutationFn: (id: string) => formsApi.duplicate(id),
    onSuccess:  (r) => { qc.invalidateQueries({ queryKey: ['forms'] }); navigate(`/forms/${r.data.form.id}/edit`) },
  })

  const trashMut = useMutation({
    mutationFn: (id: string) => formsApi.trash(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['forms'] }) },
  })

  const restoreMut = useMutation({
    mutationFn: (id: string) => formsApi.restore(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['forms'] }) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => formsApi.delete(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['forms'] }) },
  })

  const forms = data ?? []

  return (
    <div className="min-h-full" style={{ background: 'var(--body-bg)' }}>
      {/* Bannière "Nouveau formulaire" */}
      {!trashed && (
        <div className="px-8 py-6 border-b border-border" style={{ background: 'var(--color-surface-0)' }}>
          <p className="text-sm text-text-secondary mb-4 font-medium">Démarrer un nouveau formulaire</p>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {/* Vierge */}
            <button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
              className="flex flex-col items-center shrink-0"
            >
              <div className="w-36 h-48 border-2 border-border rounded-xl bg-surface-0
                              hover:border-primary hover:shadow-sm transition-all
                              flex items-center justify-center text-5xl text-text-tertiary
                              hover:text-primary">
                +
              </div>
              <span className="text-xs text-text-secondary mt-2">Vierge</span>
            </button>

            {/* Modèles */}
            {TEMPLATES.map(({ id, label, icon: Icon, color }) => (
              <button
                key={id}
                onClick={() => createMut.mutate()}
                className="flex flex-col items-center shrink-0"
              >
                <div
                  className="w-36 h-48 rounded-xl border-2 border-transparent
                              hover:border-opacity-60 hover:shadow-sm transition-all
                              flex items-center justify-center"
                  style={{ background: color + '15', borderColor: color + '40' }}
                >
                  <Icon size={40} style={{ color }} />
                </div>
                <span className="text-xs text-text-secondary mt-2">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Liste */}
      <div className="px-8 py-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-medium text-text-secondary">
            {trashed ? 'Corbeille' : 'Formulaires récents'}
            {forms.length > 0 && <span className="ml-2 text-text-tertiary">({forms.length})</span>}
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView('grid')}
              className={`p-1.5 rounded transition-colors ${view === 'grid' ? 'bg-primary-light text-primary' : 'text-text-tertiary hover:bg-surface-2'}`}
            >
              <Grid size={16} />
            </button>
            <button
              onClick={() => setView('list')}
              className={`p-1.5 rounded transition-colors ${view === 'list' ? 'bg-primary-light text-primary' : 'text-text-tertiary hover:bg-surface-2'}`}
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-text-tertiary">Chargement…</p>
          </div>
        )}

        {!isLoading && forms.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <ClipboardList size={48} className="text-text-tertiary opacity-40" />
            <p className="text-sm text-text-secondary">
              {trashed ? 'Aucun formulaire dans la corbeille' : 'Aucun formulaire pour l\'instant'}
            </p>
            {!trashed && (
              <Button icon={<Plus size={15} />} onClick={() => createMut.mutate()}>
                Créer un formulaire
              </Button>
            )}
          </div>
        )}

        {!isLoading && forms.length > 0 && view === 'grid' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {forms.map(form => (
              <FormCard
                key={form.id}
                form={form}
                trashed={trashed}
                onOpen={() => navigate(`/forms/${form.id}/edit`)}
                onDuplicate={() => duplicateMut.mutate(form.id)}
                onTrash={() => trashMut.mutate(form.id)}
                onRestore={() => restoreMut.mutate(form.id)}
                onDelete={() => deleteMut.mutate(form.id)}
              />
            ))}
          </div>
        )}

        {!isLoading && forms.length > 0 && view === 'list' && (
          <div className="space-y-1">
            {forms.map(form => (
              <FormListRow
                key={form.id}
                form={form}
                trashed={trashed}
                onOpen={() => navigate(`/forms/${form.id}/edit`)}
                onTrash={() => trashMut.mutate(form.id)}
                onRestore={() => restoreMut.mutate(form.id)}
                onDelete={() => deleteMut.mutate(form.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FormCard({ form, trashed, onOpen, onDuplicate, onTrash, onRestore, onDelete }: {
  form: FormSummary
  trashed?: boolean
  onOpen: () => void
  onDuplicate: () => void
  onTrash: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  const [menuPos, setMenuPos] = useState<MenuDropdownPos | null>(null)
  const color = (form.theme as { primaryColor?: string }).primaryColor ?? FORM_COLORS[0]

  return (
    <div className="group relative rounded-xl overflow-hidden border border-border hover:border-border-strong transition-all hover:shadow-sm bg-surface-0 cursor-pointer">
      {/* Aperçu coloré */}
      <button className="block w-full" onClick={onOpen}>
        <div className="h-32 relative flex items-end p-3" style={{ backgroundColor: color }}>
          <div className="bg-white rounded px-2 py-1 shadow-sm">
            <div className="w-16 h-1.5 rounded mb-1" style={{ background: color + '40' }} />
            <div className="w-10 h-1 bg-gray-200 rounded" />
          </div>
        </div>
      </button>

      {/* Infos */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-1">
          <button onClick={onOpen}
            className="text-sm font-medium text-text-primary truncate text-left flex-1 hover:text-primary transition-colors">
            {form.title}
          </button>
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation()
                const r = e.currentTarget.getBoundingClientRect()
                setMenuPos(p => p ? null : { top: r.bottom + 4, left: r.right - 180 })
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-text-primary hover:bg-surface-2"
            >
              <MoreVertical size={14} />
            </button>
            {menuPos && (
              <MenuDropdown
                pos={menuPos}
                onClose={() => setMenuPos(null)}
                items={!trashed ? [
                  { type: 'action', label: 'Dupliquer', icon: <Copy size={13} />, onClick: onDuplicate },
                  { type: 'separator' },
                  { type: 'action', label: 'Mettre à la corbeille', icon: <Trash2 size={13} />, danger: true, onClick: onTrash },
                ] : [
                  { type: 'action', label: 'Restaurer', icon: <RotateCcw size={13} />, onClick: onRestore },
                  { type: 'action', label: 'Supprimer définitivement', icon: <Trash2 size={13} />, danger: true, onClick: onDelete },
                ]}
              />
            )}
          </div>
        </div>
        <p className="text-xs text-text-tertiary mt-0.5">
          <Clock size={10} className="inline mr-1" />
          {formatDistanceToNow(new Date(form.updated_at), { addSuffix: true, locale: fr })}
          {form.response_count > 0 && (
            <span className="ml-2">· {form.response_count} rép.</span>
          )}
        </p>
      </div>
    </div>
  )
}

function FormListRow({ form, trashed, onOpen, onTrash, onRestore, onDelete }: {
  form: FormSummary
  trashed?: boolean
  onOpen: () => void
  onTrash: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  const [menuPos, setMenuPos] = useState<MenuDropdownPos | null>(null)
  const color = (form.theme as { primaryColor?: string }).primaryColor ?? FORM_COLORS[0]

  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-1 transition-colors cursor-pointer">
      <button onClick={onOpen} className="flex items-center gap-3 flex-1 text-left">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: color + '20' }}>
          <ClipboardList size={16} style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{form.title}</p>
          <p className="text-xs text-text-tertiary">
            {formatDistanceToNow(new Date(form.updated_at), { addSuffix: true, locale: fr })}
            {form.response_count > 0 && ` · ${form.response_count} réponse${form.response_count > 1 ? 's' : ''}`}
          </p>
        </div>
      </button>

      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            setMenuPos(p => p ? null : { top: r.bottom + 4, left: r.right - 180 })
          }}
          className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-text-primary hover:bg-surface-2"
        >
          <MoreVertical size={15} />
        </button>
        {menuPos && (
          <MenuDropdown
            pos={menuPos}
            onClose={() => setMenuPos(null)}
            items={!trashed ? [
              { type: 'action', label: 'Mettre à la corbeille', icon: <Trash2 size={13} />, danger: true, onClick: onTrash },
            ] : [
              { type: 'action', label: 'Restaurer', icon: <RotateCcw size={13} />, onClick: onRestore },
              { type: 'action', label: 'Supprimer définitivement', icon: <Trash2 size={13} />, danger: true, onClick: onDelete },
            ]}
          />
        )}
      </div>
    </div>
  )
}
