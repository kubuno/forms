import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Globe } from 'lucide-react'
import { Dropdown, Checkbox, ConfirmDialog } from '@ui'
import { useConfirm } from '@kubuno/sdk'
import { formsApi } from './api'

/**
 * Sections forms contributes to the core share dialog: who may open the form
 * (editors) and who may answer it (respondents), plus the publication notice.
 */

function Line({ icon, title, right, hint }: {
  icon: React.ReactNode; title: string; right: React.ReactNode; hint: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center shrink-0 text-text-secondary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-primary">{title}</span>
          {right}
        </div>
        <p className="text-xs text-text-secondary mt-0.5">{hint}</p>
      </div>
    </div>
  )
}

export function RespondentAccess({ target }: { target: { id: string } }) {
  const qc = useQueryClient()
  const { confirm, confirmState, handleConfirm, handleCancel } = useConfirm()
  const { data } = useQuery({
    queryKey: ['form', target.id],
    queryFn:  () => formsApi.get(target.id).then(r => r.data),
  })

  /**
   * "Supprimer le lien" is not a state but an ACTION: it issues a new public
   * token, which is the only way to cut off whoever already has the old one.
   * The dropdown therefore snaps back to "link" — that is still the situation.
   */
  const revoke = async () => {
    const ok = await confirm({
      title: 'Supprimer le lien ?',
      message: "Un nouveau lien sera créé. Les personnes qui possèdent l'ancien ne pourront plus répondre.",
      confirmLabel: 'Supprimer le lien', variant: 'danger',
    })
    if (!ok) return
    await formsApi.rotatePublicToken(target.id)
    qc.invalidateQueries({ queryKey: ['form', target.id] })
  }

  return (
    <>
      <Line icon={<Globe size={16} className="text-success" />} title="Vue Personne interrogée"
        right={
          <span className="flex items-center gap-2">
            <Dropdown
              value="link"
              width={250}
              onChange={v => { if (v === 'revoke') void revoke() }}
              options={[
                { value: 'link',   label: 'Tous les utilisateurs qui ont le lien' },
                { value: 'revoke', label: 'Supprimer le lien' },
              ]}
            />
            <span className="text-xs text-text-secondary">Répondant</span>
          </span>
        }
        hint="Tous les internautes disposant du lien peuvent répondre" />
      {confirmState && <ConfirmDialog {...confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />}
      {void data}
    </>
  )
}

export function PublishNotice({ target }: { target: { id: string } }) {
  const { data } = useQuery({
    queryKey: ['form', target.id],
    queryFn:  () => formsApi.get(target.id).then(r => r.data),
  })
  if (data?.form.published_at) return null
  return <>Publiez le formulaire pour accepter les réponses</>
}

export function EditorsMaySharePref() {
  const [on, setOn] = useState(true)
  return (
    <Checkbox checked={on} onChange={v => setOn(v)}
      label="Autoriser les éditeurs à modifier les autorisations et à partager" />
  )
}
