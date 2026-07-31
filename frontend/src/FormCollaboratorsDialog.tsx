import CollaboratorsDialog from './CollaboratorsDialog'
import { collaboratorsApi } from './api'

/** Share a form with other Kubuno users, as office does for its documents. */
export default function FormCollaboratorsDialog({ formId, onClose }: { formId: string; onClose: () => void }) {
  return (
    <CollaboratorsDialog
      entityId={formId}
      cacheKey="form-collab"
      title="Partager le formulaire"
      onClose={onClose}
      api={collaboratorsApi}
    />
  )
}
