import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@kubuno/sdk'
import { ClipboardList, Save, ChevronLeft, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Toggle, Button, Tabs } from '@ui'

type Tab = 'general' | 'responses' | 'about'

interface FormsAdminSettings {
  'forms.max_questions':           number
  'forms.max_file_upload_mb':      number
  'forms.response_retention_days': number
  'forms.submission_cooldown_secs': number
  'forms.notify_on_submit':        boolean
  'forms.notify_email':            string
}

function useAdminSettings() {
  return useQuery({
    queryKey: ['admin-settings'],
    queryFn:  () =>
      api.get<{ settings: { key: string; value: unknown }[] }>('/admin/settings').then((r) => {
        const map: Record<string, unknown> = {}
        r.data.settings.forEach((s) => { map[s.key] = s.value })
        return map as unknown as FormsAdminSettings
      }),
  })
}

function GeneralTab() {
  const qc = useQueryClient()
  const { data: settings } = useAdminSettings()

  const [maxQuestions,     setMaxQuestions]     = useState<number | null>(null)
  const [maxFileUploadMb,  setMaxFileUploadMb]  = useState<number | null>(null)
  const [retentionDays,    setRetentionDays]     = useState<number | null>(null)
  const [cooldownSecs,     setCooldownSecs]      = useState<number | null>(null)

  const cur = {
    maxQuestions:    maxQuestions    ?? (settings?.['forms.max_questions']            ?? 200),
    maxFileUploadMb: maxFileUploadMb ?? (settings?.['forms.max_file_upload_mb']       ?? 10),
    retentionDays:   retentionDays   ?? (settings?.['forms.response_retention_days']  ?? 0),
    cooldownSecs:    cooldownSecs    ?? (settings?.['forms.submission_cooldown_secs'] ?? 30),
  }

  const isDirty = maxQuestions !== null || maxFileUploadMb !== null ||
                  retentionDays !== null || cooldownSecs !== null

  const save = useMutation({
    mutationFn: (updates: Record<string, unknown>) => api.patch('/admin/settings', updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
      setMaxQuestions(null); setMaxFileUploadMb(null)
      setRetentionDays(null); setCooldownSecs(null)
    },
  })

  function handleSave() {
    const updates: Record<string, unknown> = {}
    if (maxQuestions    !== null) updates['forms.max_questions']            = maxQuestions
    if (maxFileUploadMb !== null) updates['forms.max_file_upload_mb']       = maxFileUploadMb
    if (retentionDays   !== null) updates['forms.response_retention_days']  = retentionDays
    if (cooldownSecs    !== null) updates['forms.submission_cooldown_secs'] = cooldownSecs
    if (Object.keys(updates).length > 0) save.mutate(updates)
  }

  return (
    <div>
      <div className="bg-white rounded-xl border border-border divide-y divide-border">
        {/* Max questions */}
        <div className="p-5">
          <label className="block text-sm font-medium text-text-primary mb-1">
            Nombre maximal de questions par formulaire
          </label>
          <p className="text-xs text-text-secondary mb-3">
            Limite le nombre total de questions (y compris les sections) dans un même formulaire.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={1000}
              value={cur.maxQuestions}
              onChange={(e) => setMaxQuestions(Number(e.target.value))}
              className="w-28 px-3 py-2 border border-border rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-sm text-text-tertiary">questions</span>
          </div>
        </div>

        {/* Max file upload */}
        <div className="p-5">
          <label className="block text-sm font-medium text-text-primary mb-1">
            Taille maximale des fichiers importés
          </label>
          <p className="text-xs text-text-secondary mb-3">
            Limite la taille de chaque fichier joint dans les questions de type « Upload ».
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={500}
              value={cur.maxFileUploadMb}
              onChange={(e) => setMaxFileUploadMb(Number(e.target.value))}
              className="w-28 px-3 py-2 border border-border rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-sm text-text-tertiary">Mo</span>
          </div>
        </div>

        {/* Submission cooldown */}
        <div className="p-5">
          <label className="block text-sm font-medium text-text-primary mb-1">
            Délai anti-spam entre deux soumissions (par IP)
          </label>
          <p className="text-xs text-text-secondary mb-3">
            Temps minimal entre deux soumissions consécutives depuis la même adresse IP.
            Mettre à 0 pour désactiver.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={3600}
              value={cur.cooldownSecs}
              onChange={(e) => setCooldownSecs(Number(e.target.value))}
              className="w-28 px-3 py-2 border border-border rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-sm text-text-tertiary">secondes</span>
          </div>
        </div>

        {/* Response retention */}
        <div className="p-5">
          <label className="block text-sm font-medium text-text-primary mb-1">
            Durée de conservation des réponses
          </label>
          <p className="text-xs text-text-secondary mb-3">
            Nombre de jours avant suppression automatique des réponses.
            Mettre à <code className="text-xs bg-surface-2 px-1 rounded">0</code> pour une conservation illimitée.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={3650}
              value={cur.retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
              className="w-28 px-3 py-2 border border-border rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-sm text-text-tertiary">
              {cur.retentionDays === 0 ? 'jours (illimité)' : 'jours'}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} disabled={!isDirty || save.isPending}>
          <Save size={15} />
          {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  )
}

function ResponsesTab() {
  const qc = useQueryClient()
  const { data: settings } = useAdminSettings()

  const [notifyOnSubmit, setNotifyOnSubmit] = useState<boolean | null>(null)
  const [notifyEmail,    setNotifyEmail]    = useState<string | null>(null)

  const curNotify = notifyOnSubmit ?? (settings?.['forms.notify_on_submit'] ?? false)
  const curEmail  = notifyEmail   ?? (settings?.['forms.notify_email']      ?? '')

  const isDirty = notifyOnSubmit !== null || notifyEmail !== null

  const save = useMutation({
    mutationFn: (updates: Record<string, unknown>) => api.patch('/admin/settings', updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
      setNotifyOnSubmit(null)
      setNotifyEmail(null)
    },
  })

  function handleSave() {
    const updates: Record<string, unknown> = {}
    if (notifyOnSubmit !== null) updates['forms.notify_on_submit'] = notifyOnSubmit
    if (notifyEmail    !== null) updates['forms.notify_email']     = notifyEmail
    if (Object.keys(updates).length > 0) save.mutate(updates)
  }

  return (
    <div>
      <div className="bg-white rounded-xl border border-border divide-y divide-border">
        {/* Notification on submit */}
        <div className="p-5 flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary mb-1">
              Notification par email à chaque réponse
            </p>
            <p className="text-xs text-text-secondary">
              Envoie un email à l'adresse ci-dessous lorsqu'une nouvelle réponse est soumise
              (tous formulaires confondus).
            </p>
          </div>
          <Toggle checked={curNotify} onChange={() => setNotifyOnSubmit(!curNotify)} />
        </div>

        {/* Notify email */}
        <div className="p-5">
          <label className="block text-sm font-medium text-text-primary mb-1">
            Adresse email de notification
          </label>
          <p className="text-xs text-text-secondary mb-3">
            Email qui reçoit les notifications de soumission. Laissez vide pour utiliser
            l'adresse de l'administrateur système.
          </p>
          <input
            type="email"
            value={curEmail}
            onChange={(e) => setNotifyEmail(e.target.value)}
            placeholder="notification@exemple.com"
            className="w-full max-w-sm px-3 py-2 border border-border rounded-lg text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Webhook info */}
        <div className="p-5 bg-surface-1">
          <p className="text-sm font-medium text-text-primary mb-1">Webhooks</p>
          <p className="text-xs text-text-secondary">
            Les webhooks se configurent individuellement sur chaque formulaire, depuis l'onglet
            <span className="font-medium text-text-primary"> Paramètres </span>
            de l'éditeur de formulaire.
          </p>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} disabled={!isDirty || save.isPending}>
          <Save size={15} />
          {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  )
}

function AboutTab() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-surface-1">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <ClipboardList size={20} className="text-violet-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">Kubuno Forms</p>
            <p className="text-xs text-text-tertiary">v0.1.0 · Module officiel</p>
          </div>
          <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
            Rust
          </span>
        </div>

        <div className="divide-y divide-border">
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">Description</p>
            <p className="text-sm text-text-secondary leading-relaxed">
              Créateur de formulaires en ligne inspiré de Google Forms — questions de tous types
              (texte, choix multiples, cases à cocher, liste déroulante, échelle, étoiles, date,
              heure, fichier), logique conditionnelle, analytics par question, export CSV,
              webhooks, lien public partageable sans connexion.
            </p>
          </div>

          <div className="px-5 py-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">Auteur</p>
              <p className="text-sm text-text-primary">Kubuno Contributors</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">Licence</p>
              <p className="text-sm text-text-primary">AGPL-3.0</p>
            </div>
          </div>

          <div className="px-5 py-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">Port par défaut</p>
              <p className="text-sm text-text-primary font-mono">3108</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">Schéma PostgreSQL</p>
              <p className="text-sm text-text-primary font-mono">forms</p>
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">Technologies</p>
            <div className="flex flex-wrap gap-2">
              {[
                'Rust', 'Axum 0.7', 'SQLx 0.8', 'PostgreSQL 16',
                'React 19', 'React Query v5', 'csv 1.3',
              ].map((t) => (
                <span key={t} className="text-xs px-2 py-1 rounded-lg bg-surface-2 text-text-secondary font-mono">
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">Fonctionnalités</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
              {[
                '12 types de questions',
                'Logique conditionnelle',
                'Analytics par question',
                'Export CSV',
                'Webhooks HTTP',
                'Lien public sans auth',
                'Anti-spam par IP',
                'Thème personnalisable',
                'Confirmation par email',
                'Collaborateurs',
              ].map((f) => (
                <li key={f} className="text-xs text-text-secondary flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-violet-400 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">Liens</p>
            <a
              href="https://github.com/kubuno/kubuno"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ExternalLink size={13} />
              github.com/kubuno/kubuno
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'general',   label: 'Général' },
  { id: 'responses', label: 'Réponses' },
  { id: 'about',     label: 'À propos' },
]

export default function FormsSettingsPage() {
  const [tab, setTab] = useState<Tab>('general')

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/admin?tab=modules"
          className="p-1.5 rounded-lg hover:bg-surface-2 text-text-secondary hover:text-text-primary transition-colors"
        >
          <ChevronLeft size={18} />
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
            <ClipboardList size={16} className="text-violet-600" />
          </div>
          <div>
            <h1 className="text-lg font-medium text-text-primary">Paramètres — Kubuno Forms</h1>
            <p className="text-xs text-text-tertiary">Formulaires, réponses et webhooks</p>
          </div>
        </div>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-6" />

      {tab === 'general'   && <GeneralTab />}
      {tab === 'responses' && <ResponsesTab />}
      {tab === 'about'     && <AboutTab />}
    </div>
  )
}
