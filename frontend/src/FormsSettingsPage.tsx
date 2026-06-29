import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ClipboardList, ArrowLeft, ExternalLink, Check } from 'lucide-react'
import { Toggle, Button, Radio } from '@ui'
import { useModulePrefs } from './userPrefs'

// ── Per-user preferences (backend, cross-device via core users.preferences) ─────

// Type alias (not interface) so it satisfies the `Record<string, unknown>`
// constraint of useModulePrefs (interfaces lack an implicit index signature).
type FormsPrefs = {
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

// Instance-wide settings (max questions, file size, retention, cooldown,
// notifications…) are now declared in module.toml `[[settings]]` and edited from
// the core admin console — no longer a tab inside the module.

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

type Tab = 'preferences' | 'about'

export default function FormsSettingsPage() {
  const { t } = useTranslation('forms')
  const [tab, setTab] = useState<Tab>('preferences')

  // Instance-wide settings are now edited from the core admin console; this page
  // only hosts the per-user preferences and the module's "About" panel.
  const visibleTabs: { id: Tab; label: string }[] = [
    { id: 'preferences', label: t('forms_tab_preferences', { defaultValue: 'Préférences' }) },
    { id: 'about',       label: t('forms_tab_about', { defaultValue: 'À propos' }) },
  ]

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
          {tab === 'about'       && <AboutTab />}
        </div>
      </div>
    </div>
  )
}
