/** Bundle MODULE forms — chargé à l'exécution (cf. vite.module.config). */
import { lazy } from 'react'
import { RouteRegistry, WaffleAppRegistry, useToolbarStore, useSearchStore, SDK_VERSION } from '@kubuno/sdk'
import { ClipboardList } from 'lucide-react'
import './index.css'

export const sdkVersion = SDK_VERSION

export function register() {
  WaffleAppRegistry.register('forms', 'Formulaires', [
    { id: 'forms', label: 'Formulaires', Icon: ClipboardList, path: '/forms' },
  ])

  useToolbarStore.getState().register({
    moduleId:    'forms',
    routePrefix: '/forms',
  })

  useSearchStore.getState().register({
    moduleId:    'forms',
    routePrefix: '/forms',
    placeholder: 'Rechercher dans les formulaires…',
    onSearch:    () => {},
  })

  // Routes
  const FormsListPage   = lazy(() => import('./FormsListPage'))
  const FormEditorPage  = lazy(() => import('./FormEditorPage'))
  const FormsSettingsPage = lazy(() => import('./FormsSettingsPage'))
  const PublicFormPage  = lazy(() => import('./PublicFormPage'))

  RouteRegistry.register('forms',          FormsListPage)
  RouteRegistry.register('forms/trash',    FormsListPage, { trashed: true })
  RouteRegistry.register('forms/:id/edit', FormEditorPage)
  RouteRegistry.register('forms/settings', FormsSettingsPage)

  RouteRegistry.registerPublic('forms/public/:token', PublicFormPage)
}
