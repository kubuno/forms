// Central registry describing every question type: its label, icon, editor
// capabilities and default options. Shared by the editor and the public filler.
import {
  AlignLeft, Type, Mail, Hash, Phone, Link2,
  CircleDot, CheckSquare, ChevronDownSquare, ToggleRight, ListOrdered,
  Sliders, Gauge, Star,
  Calendar, Clock,
  Upload, PenLine, Grid3X3,
  Heading, Minus, Hand, PartyPopper, Image as ImageIcon, Clapperboard,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { QuestionType } from './api'

export type QTypeGroup = 'text' | 'choice' | 'scale' | 'datetime' | 'media' | 'content'

export interface QTypeMeta {
  value:        QuestionType
  label:        string
  Icon:         LucideIcon
  group:        QTypeGroup
  /** Editable list of options (multiple_choice/checkbox/dropdown/ranking). */
  hasOptions?:  boolean
  /** Numeric scale settings (min/max/labels). */
  hasScale?:    boolean
  /** No answer is collected (content / layout only). */
  isContent?:   boolean
  /** Can be marked correct/incorrect in quiz mode. */
  supportsQuiz?: boolean
}

export const GROUP_LABELS: Record<QTypeGroup, string> = {
  text:     'Texte',
  choice:   'Choix',
  scale:    'Évaluation',
  datetime: 'Date et heure',
  media:    'Média',
  content:  'Mise en page',
}

export const QUESTION_TYPES: QTypeMeta[] = [
  // Texte
  { value: 'short_text', label: 'Réponse courte',  Icon: Type,     group: 'text', supportsQuiz: true },
  { value: 'long_text',  label: 'Paragraphe',      Icon: AlignLeft, group: 'text' },
  { value: 'email',      label: 'E-mail',          Icon: Mail,     group: 'text' },
  { value: 'number',     label: 'Nombre',          Icon: Hash,     group: 'text', supportsQuiz: true },
  { value: 'phone',      label: 'Téléphone',       Icon: Phone,    group: 'text' },
  { value: 'url',        label: 'Lien (URL)',      Icon: Link2,    group: 'text' },
  // Choix
  { value: 'multiple_choice', label: 'Choix unique',     Icon: CircleDot,         group: 'choice', hasOptions: true, supportsQuiz: true },
  { value: 'checkbox',        label: 'Cases à cocher',   Icon: CheckSquare,       group: 'choice', hasOptions: true, supportsQuiz: true },
  { value: 'dropdown',        label: 'Liste déroulante', Icon: ChevronDownSquare, group: 'choice', hasOptions: true, supportsQuiz: true },
  { value: 'yes_no',          label: 'Oui / Non',        Icon: ToggleRight,       group: 'choice', supportsQuiz: true },
  { value: 'ranking',         label: 'Classement',       Icon: ListOrdered,       group: 'choice', hasOptions: true },
  // Évaluation
  { value: 'linear_scale',  label: 'Échelle linéaire',     Icon: Sliders, group: 'scale', hasScale: true, supportsQuiz: true },
  { value: 'opinion_scale', label: 'Échelle d’opinion (NPS)', Icon: Gauge,  group: 'scale', hasScale: true },
  { value: 'rating',        label: 'Notation (étoiles)',   Icon: Star,    group: 'scale', supportsQuiz: true },
  // Date et heure
  { value: 'date', label: 'Date',  Icon: Calendar, group: 'datetime' },
  { value: 'time', label: 'Heure', Icon: Clock,    group: 'datetime' },
  // Média
  { value: 'file_upload', label: 'Téléversement de fichier', Icon: Upload,  group: 'media' },
  { value: 'signature',   label: 'Signature',                Icon: PenLine, group: 'media' },
  { value: 'grid_radio',    label: 'Grille — choix unique', Icon: Grid3X3, group: 'media', hasOptions: true },
  { value: 'grid_checkbox', label: 'Grille — cases',        Icon: Grid3X3, group: 'media', hasOptions: true },
  // Mise en page / contenu
  { value: 'image',            label: 'Image',               Icon: ImageIcon,   group: 'content', isContent: true },
  { value: 'video',            label: 'Vidéo',               Icon: Clapperboard, group: 'content', isContent: true },
  { value: 'statement',        label: 'Texte d’information', Icon: Heading,     group: 'content', isContent: true },
  { value: 'section',          label: 'Saut de section',     Icon: Minus,       group: 'content', isContent: true },
  { value: 'welcome_screen',   label: 'Écran d’accueil',     Icon: Hand,        group: 'content', isContent: true },
  { value: 'thank_you_screen', label: 'Écran de remerciement', Icon: PartyPopper, group: 'content', isContent: true },
]

const META_BY_TYPE: Record<string, QTypeMeta> = Object.fromEntries(
  QUESTION_TYPES.map(t => [t.value, t]),
)

export function getMeta(type: string): QTypeMeta {
  return META_BY_TYPE[type] ?? {
    value: type as QuestionType, label: type, Icon: Type, group: 'text',
  }
}

/** Types that never collect an answer (skipped in answer mapping/validation). */
export function isContentType(type: string): boolean {
  return !!getMeta(type).isContent || type === 'image' || type === 'video'
}

/** Default `options` object to seed when switching a question to `type`. */
export function defaultOptionsFor(type: string): Record<string, unknown> {
  switch (type) {
    case 'multiple_choice':
    case 'checkbox':
    case 'dropdown':
    case 'ranking':
      return { options: [
        { id: genId(), label: 'Option 1' },
        { id: genId(), label: 'Option 2' },
      ] }
    case 'linear_scale':
      return { min: 1, max: 5, minLabel: '', maxLabel: '' }
    case 'opinion_scale':
      return { min: 0, max: 10, minLabel: 'Pas du tout probable', maxLabel: 'Très probable' }
    case 'rating':
      return { max: 5, icon: 'star' }
    case 'grid_radio':
    case 'grid_checkbox':
      return {
        rows:    [{ id: genId(), label: 'Ligne 1' }, { id: genId(), label: 'Ligne 2' }],
        columns: [{ id: genId(), label: 'Colonne 1' }, { id: genId(), label: 'Colonne 2' }],
      }
    case 'file_upload':
      return { accept: '', maxSizeMb: 10 }
    case 'welcome_screen':
      return { buttonText: 'Commencer' }
    case 'statement':
      return { buttonText: 'Continuer' }
    default:
      return {}
  }
}

let _seq = 0
/** Stable-enough id for client-created options (no crypto needed here). */
export function genId(): string {
  _seq += 1
  return `o${Date.now().toString(36)}${_seq.toString(36)}`
}
