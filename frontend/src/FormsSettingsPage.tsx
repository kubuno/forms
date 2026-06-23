import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, useAuthStore } from '@kubuno/sdk'
import { ClipboardList, Save, ArrowLeft, ExternalLink, Check } from 'lucide-react'
import { Toggle, Button, Radio } from '@ui'
import { useModulePrefs } from './userPrefs'

// ── Per-user preferences (backend, cross-device via core users.preferences) ─────

interface FormsPrefs {
  defaultView:   string   // 'grid' | 'list'
  defaultSort:   string   // 'recent' | 'name' | 'responses'
  defaultColor:  string   // hex color seeded into new forms' theme
  notifyOnReply: boolean  // notify me when a new response is submitted
  showProgress:  boolean  // show progress bar on public forms by default
  confirmDelete: boolean  // ask for confirmation before deleting a form
}

const DEFAULT_PREFS: FormsPrefs = {
  defaultView: 'grid', defaultSort: 'recent', defaultColor: '#673ab7',
  notifyOnReply: false, showProgress: true, confirmDelete: true,
}

// Theme colors offered for the default new-form accent.
const COLOR_CHOICES = [
  '#673ab7', '#1a73e8', '#0f9d58', '#d93025',
  '#e8711a', '#9c27b0', '#00838f', '#5f6368',
]

// ── Mail-style layout helpers ───────────────────────────────────────────────────

function SettingsRow({ label, description, children }: {
  label: string; description?: string; children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-8 py-4 border-b border-[#e8eaed] last:border-0">
      <div className="w-60 flex-shrink-0">
        <p className="text-sm text-[#202124] font-normal">{label}</p>
        {description && <p className="text-xs text-text-tertiary mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function RadioGroup({ options, value, onChange }: {
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      {options.map(opt => (
        <Radio key={opt.value} checked={value === opt.value} onChange={() => onChange(opt.value)} label={opt.label} />
      ))}
    </div>
  )
}

// ── Préférences tab (per-user) ──────────────────────────────────────────────────

function PreferencesTab() {
  const { t } = useTranslation('forms')
  const { prefs: saved, update } = useModulePrefs<FormsPrefs>('forms', DEFAULT_PREFS)
  const [prefs, setPrefs] = useState<FormsPrefs>(saved)
  const [savedFlag, setSavedFlag] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof FormsPrefs>(key: K, value: FormsPrefs[K]) =>
    setPrefs(p => ({ ...p, [key]: value }))

  const save = async () => {
    setBusy(true)
    try {
      await update(prefs)
      setSavedFlag(true)
      setTimeout(() => setSavedFlag(false), 2500)
    } finally { setBusy(false) }
  }

  return (
    <div>
      <SettingsRow
        label={t('forms_pref_view', { defaultValue: 'Affichage par défaut' })}
        description={t('forms_pref_view_desc', { defaultValue: 'Disposition de la liste des formulaires à l\'ouverture.' })}
      >
        <RadioGroup
          value={prefs.defaultView}
          onChange={v => set('defaultView', v)}
          options={[
            { value: 'grid', label: t('forms_pref_view_grid', { defaultValue: 'Grille (vignettes)' }) },
            { value: 'list', label: t('forms_pref_view_list', { defaultValue: 'Liste' }) },
          ]}
        />
      </SettingsRow>

      <SettingsRow label={t('forms_pref_sort', { defaultValue: 'Tri par défaut' })}>
        <RadioGroup
          value={prefs.defaultSort}
          onChange={v => set('defaultSort', v)}
          options={[
            { value: 'recent',    label: t('forms_pref_sort_recent',    { defaultValue: 'Modifiés récemment' }) },
            { value: 'name',      label: t('forms_pref_sort_name',      { defaultValue: 'Nom (A → Z)' }) },
            { value: 'responses', label: t('forms_pref_sort_responses', { defaultValue: 'Nombre de réponses' }) },
          ]}
        />
      </SettingsRow>

      <SettingsRow
        label={t('forms_pref_color', { defaultValue: 'Thème des nouveaux formulaires' })}
        description={t('forms_pref_color_desc', { defaultValue: 'Couleur d\'accent appliquée par défaut aux formulaires que vous créez.' })}
      >
        <div className="flex flex-wrap gap-2">
          {COLOR_CHOICES.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => set('defaultColor', c)}
              aria-label={c}
              className={`w-7 h-7 rounded-full transition-transform ${
                prefs.defaultColor === c
                  ? 'scale-125 ring-2 ring-offset-1 ring-gray-400'
                  : 'hover:scale-110'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      </SettingsRow>

      <SettingsRow
        label={t('forms_pref_notify', { defaultValue: 'Notifications de réponses' })}
        description={t('forms_pref_notify_desc', { defaultValue: 'Recevoir une notification lorsqu\'une nouvelle réponse est soumise à vos formulaires.' })}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle checked={prefs.notifyOnReply} onChange={() => set('notifyOnReply', !prefs.notifyOnReply)} />
          <span className="text-sm text-text-primary">{t('forms_pref_notify_on', { defaultValue: 'M\'avertir des nouvelles réponses' })}</span>
        </label>
      </SettingsRow>

      <SettingsRow
        label={t('forms_pref_progress', { defaultValue: 'Barre de progression' })}
        description={t('forms_pref_progress_desc', { defaultValue: 'Afficher l\'avancement aux répondants sur les formulaires à plusieurs sections.' })}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle checked={prefs.showProgress} onChange={() => set('showProgress', !prefs.showProgress)} />
          <span className="text-sm text-text-primary">{t('forms_pref_progress_on', { defaultValue: 'Afficher la progression' })}</span>
        </label>
      </SettingsRow>

      <SettingsRow
        label={t('forms_pref_confirm', { defaultValue: 'Confirmation de suppression' })}
        description={t('forms_pref_confirm_desc', { defaultValue: 'Demander une confirmation avant de supprimer un formulaire.' })}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle checked={prefs.confirmDelete} onChange={() => set('confirmDelete', !prefs.confirmDelete)} />
          <span className="text-sm text-text-primary">{t('forms_pref_confirm_on', { defaultValue: 'Confirmer avant suppression' })}</span>
        </label>
      </SettingsRow>

      <div className="pt-5 flex items-center gap-3">
        <Button onClick={save} loading={busy}>
          {savedFlag
            ? <><Check size={14} className="mr-1.5 inline" />{t('forms_settings_saved', { defaultValue: 'Enregistré' })}</>
            : t('forms_settings_save_changes', { defaultValue: 'Enregistrer les modifications' })}
        </Button>
        <Button variant="ghost" onClick={() => setPrefs(saved)}>
          {t('common_cancel', { defaultValue: 'Annuler' })}
        </Button>
      </div>
    </div>
  )
}

// ── Admin-only global settings (instance, via /admin/settings) ──────────────────

interface FormsAdminSettings {
  'forms.max_questions':            number
  'forms.max_file_upload_mb':       number
  'forms.response_retention_days':  number
  'forms.submission_cooldown_secs': number
  'forms.notify_on_submit':         boolean
  'forms.notify_email':             string
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
  const { t } = useTranslation('forms')
  const qc = useQueryClient()
  const { data: settings } = useAdminSettings()

  const [maxQuestions,     setMaxQuestions]    = useState<number | null>(null)
  const [maxFileUploadMb,  setMaxFileUploadMb] = useState<number | null>(null)
  const [retentionDays,    setRetentionDays]   = useState<number | null>(null)
  const [cooldownSecs,     setCooldownSecs]    = useState<number | null>(null)

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
            {t('forms_admin_max_questions', { defaultValue: 'Nombre maximal de questions par formulaire' })}
          </label>
          <p className="text-xs text-text-secondary mb-3">
            {t('forms_admin_max_questions_desc', { defaultValue: 'Limite le nombre total de questions (y compris les sections) dans un même formulaire.' })}
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
            <span className="text-sm text-text-tertiary">{t('forms_admin_questions_unit', { defaultValue: 'questions' })}</span>
          </div>
        </div>

        {/* Max file upload */}
        <div className="p-5">
          <label className="block text-sm font-medium text-text-primary mb-1">
            {t('forms_admin_max_file', { defaultValue: 'Taille maximale des fichiers importés' })}
          </label>
          <p className="text-xs text-text-secondary mb-3">
            {t('forms_admin_max_file_desc', { defaultValue: 'Limite la taille de chaque fichier joint dans les questions de type « Upload ».' })}
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
            <span className="text-sm text-text-tertiary">{t('forms_admin_mb_unit', { defaultValue: 'Mo' })}</span>
          </div>
        </div>

        {/* Submission cooldown */}
        <div className="p-5">
          <label className="block text-sm font-medium text-text-primary mb-1">
            {t('forms_admin_cooldown', { defaultValue: 'Délai anti-spam entre deux soumissions (par IP)' })}
          </label>
          <p className="text-xs text-text-secondary mb-3">
            {t('forms_admin_cooldown_desc', { defaultValue: 'Temps minimal entre deux soumissions consécutives depuis la même adresse IP. Mettre à 0 pour désactiver.' })}
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
            <span className="text-sm text-text-tertiary">{t('forms_admin_secs_unit', { defaultValue: 'secondes' })}</span>
          </div>
        </div>

        {/* Response retention */}
        <div className="p-5">
          <label className="block text-sm font-medium text-text-primary mb-1">
            {t('forms_admin_retention', { defaultValue: 'Durée de conservation des réponses' })}
          </label>
          <p className="text-xs text-text-secondary mb-3">
            {t('forms_admin_retention_desc', { defaultValue: 'Nombre de jours avant suppression automatique des réponses. Mettre à 0 pour une conservation illimitée.' })}
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
              {cur.retentionDays === 0
                ? t('forms_admin_days_unlimited', { defaultValue: 'jours (illimité)' })
                : t('forms_admin_days_unit', { defaultValue: 'jours' })}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} disabled={!isDirty || save.isPending} icon={<Save size={15} />}>
          {save.isPending
            ? t('forms_admin_saving', { defaultValue: 'Enregistrement…' })
            : t('forms_admin_save', { defaultValue: 'Enregistrer' })}
        </Button>
      </div>
    </div>
  )
}

function ResponsesTab() {
  const { t } = useTranslation('forms')
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
              {t('forms_admin_notify_title', { defaultValue: 'Notification par email à chaque réponse' })}
            </p>
            <p className="text-xs text-text-secondary">
              {t('forms_admin_notify_desc', { defaultValue: 'Envoie un email à l\'adresse ci-dessous lorsqu\'une nouvelle réponse est soumise (tous formulaires confondus).' })}
            </p>
          </div>
          <Toggle checked={curNotify} onChange={() => setNotifyOnSubmit(!curNotify)} />
        </div>

        {/* Notify email */}
        <div className="p-5">
          <label className="block text-sm font-medium text-text-primary mb-1">
            {t('forms_admin_notify_email', { defaultValue: 'Adresse email de notification' })}
          </label>
          <p className="text-xs text-text-secondary mb-3">
            {t('forms_admin_notify_email_desc', { defaultValue: 'Email qui reçoit les notifications de soumission. Laissez vide pour utiliser l\'adresse de l\'administrateur système.' })}
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
          <p className="text-sm font-medium text-text-primary mb-1">{t('forms_admin_webhooks', { defaultValue: 'Webhooks' })}</p>
          <p className="text-xs text-text-secondary">
            {t('forms_admin_webhooks_desc', { defaultValue: 'Les webhooks se configurent individuellement sur chaque formulaire, depuis l\'onglet Paramètres de l\'éditeur de formulaire.' })}
          </p>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} disabled={!isDirty || save.isPending} icon={<Save size={15} />}>
          {save.isPending
            ? t('forms_admin_saving', { defaultValue: 'Enregistrement…' })
            : t('forms_admin_save', { defaultValue: 'Enregistrer' })}
        </Button>
      </div>
    </div>
  )
}

function AboutTab() {
  const { t } = useTranslation('forms')
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-surface-1">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <ClipboardList size={20} className="text-violet-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">Kubuno Forms</p>
            <p className="text-xs text-text-tertiary">v0.1.0 · {t('forms_official_module', { defaultValue: 'Module officiel' })}</p>
          </div>
          <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
            Rust
          </span>
        </div>

        <div className="divide-y divide-border">
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">{t('forms_about_description', { defaultValue: 'Description' })}</p>
            <p className="text-sm text-text-secondary leading-relaxed">
              {t('forms_about_text', { defaultValue: 'Créateur de formulaires en ligne — questions de tous types (texte, choix multiples, cases à cocher, liste déroulante, échelle, étoiles, date, heure, fichier), logique conditionnelle, analytics par question, export CSV, webhooks, lien public partageable sans connexion.' })}
            </p>
          </div>

          <div className="px-5 py-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">{t('forms_about_port', { defaultValue: 'Port par défaut' })}</p>
              <p className="text-sm text-text-primary font-mono">3108</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">{t('forms_about_schema', { defaultValue: 'Schéma PostgreSQL' })}</p>
              <p className="text-sm text-text-primary font-mono">forms</p>
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">{t('forms_about_links', { defaultValue: 'Liens' })}</p>
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

// ── Main page (mail-style breadcrumb + tab bar) ─────────────────────────────────

type Tab = 'preferences' | 'general' | 'responses' | 'about'

export default function FormsSettingsPage() {
  const { t } = useTranslation('forms')
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const [tab, setTab] = useState<Tab>('preferences')

  // Admin-only tabs (instance-wide settings) are hidden for non-admins.
  const tabs: { id: Tab; label: string; adminOnly?: boolean }[] = [
    { id: 'preferences', label: t('forms_tab_preferences', { defaultValue: 'Préférences' }) },
    { id: 'general',     label: t('forms_tab_general',   { defaultValue: 'Général' }), adminOnly: true },
    { id: 'responses',   label: t('forms_tab_responses', { defaultValue: 'Réponses' }), adminOnly: true },
    { id: 'about',       label: t('forms_tab_about', { defaultValue: 'À propos' }) },
  ]
  const visibleTabs = tabs.filter(tb => !tb.adminOnly || isAdmin)

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-[#e8eaed] flex-shrink-0" style={{ background: '#f8f9fa' }}>
        <Link to="/forms" className="flex items-center gap-1.5 text-sm text-[#1a73e8] hover:underline">
          <ArrowLeft size={14} />
          {t('forms_settings_breadcrumb', { defaultValue: 'Formulaires' })}
        </Link>
        <span className="text-text-tertiary text-sm">/</span>
        <div className="flex items-center gap-1.5">
          <ClipboardList size={15} className="text-text-secondary" />
          <span className="text-sm text-text-primary">{t('forms_settings_title', { defaultValue: 'Réglages' })}</span>
        </div>
      </div>

      {/* Tab bar (Gmail-style) */}
      <div className="flex items-end border-b border-[#e8eaed] px-4 flex-shrink-0 overflow-x-auto overflow-y-hidden" style={{ background: '#fff' }}>
        {visibleTabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={`px-4 py-3 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === tb.id ? 'border-[#1a73e8] text-[#1a73e8] font-medium' : 'border-transparent text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4]'}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-6">
          {tab === 'preferences' && <PreferencesTab />}
          {tab === 'general'   && isAdmin && <GeneralTab />}
          {tab === 'responses' && isAdmin && <ResponsesTab />}
          {tab === 'about'     && <AboutTab />}
        </div>
      </div>
    </div>
  )
}
