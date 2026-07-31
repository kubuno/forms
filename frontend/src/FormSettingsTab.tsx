import type { ReactNode } from 'react'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Toggle, Input, Textarea, DatePicker, Dropdown } from '@ui'
import type { Form } from './api'
import { useModulePrefs, FORM_DEFAULTS, collectEmailMode, type FormDefaults } from './userPrefs'

/**
 * Settings tab: one "Paramètres" card holding the quiz switch plus two
 * collapsible groups (Réponses, Présentation), then a "Valeurs par défaut"
 * card for the per-user defaults applied to new forms and questions.
 *
 * Everything is collapsed by default: the tab is a map of what can be tuned,
 * not a wall of controls.
 */

/** One setting: label and optional explanation on the left, control on the right. */
function Row({ title, description, disabled, children }: {
  title: string; description?: ReactNode; disabled?: boolean; children: ReactNode
}) {
  return (
    <div className={`flex items-start justify-between gap-6 py-3 ${disabled ? 'opacity-50' : ''}`}>
      <div className="min-w-0">
        <div className="text-xs text-text-primary">{title}</div>
        {description && <div className="text-xs text-text-secondary mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  )
}

/** Small caps heading that splits a group into themes. */
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs text-text-tertiary pt-4 pb-1 first:pt-0">
      {children}
    </div>
  )
}

/**
 * A collapsible group: title, one-line explanation, chevron — separated from
 * its neighbours by a hairline, nothing else.
 *
 * Hand-rolled rather than `@ui`'s Accordion, which boxes every item in a border
 * and upper-cases its header: too heavy for a settings list.
 */
function Section({ title, description, children }: {
  title: string; description: string; children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-border first:border-t-0">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-4 py-4 text-left">
        <span>
          <span className="block text-xs text-text-primary">{title}</span>
          <span className="block text-xs text-text-secondary">{description}</span>
        </span>
        <ChevronDown size={18} className="shrink-0 text-text-secondary transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && <div className="pb-4 pl-4">{children}</div>}
    </div>
  )
}

export default function FormSettingsTab({ form, color, onUpdate }: {
  form: Form
  color: string
  onUpdate: (s: Partial<Form['settings']>) => void
}) {
  const s = form.settings
  const mode = s.displayMode ?? 'one_at_a_time'
  const { prefs, update: updatePrefs } = useModulePrefs<FormDefaults>('forms-defaults', FORM_DEFAULTS)

  const answers = (
    <div className="pt-1">
      <Row title="Collecter les adresses e-mail">
        <Toggle checked={s.collectEmail} onChange={e => onUpdate({ collectEmail: e.target.checked })} />
      </Row>
      <Row
        title="Envoyer aux participants une copie de leur réponse"
        description={<><b>Collecter les adresses e-mail</b> doit être activé</>}
        disabled={!s.collectEmail}
      >
        <Toggle checked={!!s.sendConfirmationEmail} disabled={!s.collectEmail}
          onChange={e => onUpdate({ sendConfirmationEmail: e.target.checked })} />
      </Row>
      <Row title="Autoriser la modification des réponses"
        description="Les réponses peuvent être modifiées après leur envoi">
        <Toggle checked={s.allowEditAfterSubmit} onChange={e => onUpdate({ allowEditAfterSubmit: e.target.checked })} />
      </Row>
      <Row title="Accepter les réponses"
        description="Désactivez pour clore le formulaire sans le supprimer">
        <Toggle checked={s.acceptingResponses} onChange={e => onUpdate({ acceptingResponses: e.target.checked })} />
      </Row>

      <GroupLabel>Connexion obligatoire</GroupLabel>
      <Row title="Exiger une connexion"
        description="Les personnes répondant doivent se connecter à leur compte">
        <Toggle checked={s.requireSignIn} onChange={e => onUpdate({ requireSignIn: e.target.checked })} />
      </Row>
      <Row title="Limiter à une réponse"
        description={<><b>Exiger une connexion</b> doit être activé</>}
        disabled={!s.requireSignIn}
      >
        <Toggle checked={s.limitToOneResponse} disabled={!s.requireSignIn}
          onChange={e => onUpdate({ limitToOneResponse: e.target.checked })} />
      </Row>

      <GroupLabel>Limites</GroupLabel>
      <Row title="Nombre maximum de réponses" description="Laissez vide pour ne pas limiter">
        <Input type="number" defaultValue={s.maxResponses ?? ''} placeholder="Illimité" className="w-32"
          onBlur={e => onUpdate({ maxResponses: e.target.value ? parseInt(e.target.value) : null })} />
      </Row>
      <Row title="Date de clôture" description="Le formulaire n'accepte plus de réponse passé cette date">
        <DatePicker mode="datetime" clearable
          value={s.closeDate ? new Date(s.closeDate).toISOString().slice(0, 16) : null}
          onChange={v => onUpdate({ closeDate: v ? new Date(v).toISOString() : null })} />
      </Row>

      <GroupLabel>Notifications</GroupLabel>
      <Row title="URL de rappel (webhook)" description="Appelée à chaque nouvelle réponse">
        <Input type="url" defaultValue={s.webhookUrl ?? ''} placeholder="https://exemple.com/webhook"
          className="w-72" onBlur={e => onUpdate({ webhookUrl: e.target.value || null })} />
      </Row>
    </div>
  )

  const presentation = (
    <div className="pt-1">
      <GroupLabel>Présentation du formulaire</GroupLabel>
      <div className="grid grid-cols-3 gap-3 py-2">
        {([
          { id: 'one_at_a_time', label: 'Une question à la fois', desc: 'Immersif, une étape par écran' },
          { id: 'section',       label: 'Par section',            desc: 'Une section par écran' },
          { id: 'classic',       label: 'Toutes les questions',   desc: 'Classique, un seul défilement' },
        ] as const).map(opt => (
          <button key={opt.id} onClick={() => onUpdate({ displayMode: opt.id })}
            className="text-left rounded-lg border-2 p-3 transition-colors"
            style={{ borderColor: mode === opt.id ? color : 'var(--color-border)' }}>
            <div className="text-xs text-text-primary">{opt.label}</div>
            <div className="text-xs text-text-secondary">{opt.desc}</div>
          </button>
        ))}
      </div>
      <Row title="Afficher la barre de progression">
        <Toggle checked={s.showProgressBar} onChange={e => onUpdate({ showProgressBar: e.target.checked })} />
      </Row>
      <Row title="Trier les questions en mode aléatoire"
        description="L'ordre change à chaque participant">
        <Toggle checked={!!s.shuffleQuestions} onChange={e => onUpdate({ shuffleQuestions: e.target.checked })} />
      </Row>

      <GroupLabel>Après envoi</GroupLabel>
      <div className="py-2">
        <div className="text-xs text-text-primary mb-1">Message de confirmation</div>
        <Textarea defaultValue={s.confirmationMessage} rows={2} className="w-full"
          onBlur={e => onUpdate({ confirmationMessage: e.target.value })} />
      </div>
      {s.quizMode && (
        <Row title="Afficher le score immédiatement"
          description="Le participant voit sa note dès l'envoi">
          <Toggle checked={s.showResultImmediately ?? true}
            onChange={e => onUpdate({ showResultImmediately: e.target.checked })} />
        </Row>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-6">
        <h3 className="text-base text-text-primary pb-3">Paramètres</h3>

        <div className="border-t border-border">
          <Row title="Convertir en questionnaire"
            description="Attribuez des barèmes de notation, définissez les bonnes réponses et ajoutez automatiquement des commentaires.">
            <Toggle checked={!!s.quizMode} onChange={e => onUpdate({ quizMode: e.target.checked })} />
          </Row>
        </div>

        <Section title="Réponses" description="Gérez la façon dont les réponses sont collectées et protégées">
          {answers}
        </Section>
        <Section title="Présentation" description="Gérez la façon dont le formulaire et les réponses sont présentés">
          {presentation}
        </Section>
      </div>

      <div className="bg-white rounded-xl p-6">
        <h3 className="text-base text-text-primary pb-3">Valeurs par défaut</h3>
        <Section title="Paramètres par défaut des formulaires" description="Appliqués aux nouveaux formulaires">
          <Row title="Collecter les adresses e-mail par défaut">
            <Dropdown
              value={collectEmailMode(prefs.defaultCollectEmail)}
              width={240}
              onChange={v => updatePrefs({ defaultCollectEmail: v as FormDefaults['defaultCollectEmail'] })}
              options={[
                { value: 'none',      label: 'Ne pas collecter' },
                { value: 'verified',  label: 'Validées' },
                { value: 'responder', label: 'Informations saisies par le participant' },
              ]}
            />
          </Row>
        </Section>
        <Section title="Paramètres par défaut des questions" description="Appliqués à toutes les nouvelles questions">
          <Row title="Rendre les questions obligatoires par défaut">
            <Toggle checked={prefs.defaultRequired}
              onChange={e => updatePrefs({ defaultRequired: e.target.checked })} />
          </Row>
        </Section>
      </div>
    </div>
  )
}
