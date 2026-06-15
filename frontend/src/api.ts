import { api } from '@kubuno/sdk'

// ── Types ────────────────────────────────────────────────────────────────────

export interface FormTheme {
  primaryColor:    string
  headerColor:     string
  fontFamily:      string
  backgroundImage: string | null
  style:           'default' | 'classic' | 'playful'
}

export interface FormSettings {
  collectEmail:          boolean
  limitToOneResponse:    boolean
  allowEditAfterSubmit:  boolean
  showProgressBar:       boolean
  shuffleQuestions:      boolean
  requireSignIn:         boolean
  confirmationMessage:   string
  sendConfirmationEmail: boolean
  acceptingResponses:    boolean
  closeDate:             string | null
  maxResponses:          number | null
  webhookUrl:            string | null
}

export interface FormSummary {
  id:               string
  owner_id:         string
  title:            string
  description:      string | null
  theme:            FormTheme
  response_count:   number
  last_response_at: string | null
  is_trashed:       boolean
  published_at:     string | null
  created_at:       string
  updated_at:       string
}

export interface Form extends FormSummary {
  header_image_path: string | null
  settings:          FormSettings
  public_token:      string
}

export type QuestionType =
  | 'short_text' | 'long_text'
  | 'multiple_choice' | 'checkbox' | 'dropdown'
  | 'linear_scale' | 'rating'
  | 'date' | 'time'
  | 'file_upload' | 'image' | 'video'
  | 'grid_radio' | 'grid_checkbox'
  | 'section'

export interface Question {
  id:                 string
  form_id:            string
  position:           number
  question_type:      QuestionType
  title:              string
  description:        string | null
  required:           boolean
  image_path:         string | null
  options:            Record<string, unknown>
  points:             number
  correct_answers:    unknown[]
  feedback_correct:   string | null
  feedback_incorrect: string | null
  created_at:         string
  updated_at:         string
}

export interface FormResponse {
  id:                 string
  form_id:            string
  respondent_id:      string | null
  respondent_email:   string | null
  respondent_name:    string | null
  fill_duration_secs: number | null
  score:              number | null
  max_score:          number | null
  source:             string
  submitted_at:       string
}

export interface Answer {
  id:           string
  response_id:  string
  question_id:  string
  value:        unknown
  is_correct:   boolean | null
  points_earned: number
  created_at:   string
}

export interface AnswerInput {
  question_id: string
  value:       unknown
}

export interface QuestionStat {
  question_id:   string
  question_type: string
  title:         string
  total_answers: number
  stat_type:     'distribution' | 'scale' | 'text' | 'raw'
  distribution?: Array<{ option_id: string; label: string; count: number; percentage: number }>
  mean?:         number
  median?:       number
  frequency?:    Record<string, number>
  texts?:        string[]
}

export interface ConditionalRule {
  id:                  string
  form_id:             string
  position:            number
  trigger_question_id: string
  operator:            string
  compare_value:       unknown
  action:              string
  target_section_id:   string | null
  created_at:          string
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const formsApi = {
  // Formulaires
  list:       (params?: { trashed?: boolean; limit?: number; offset?: number }) =>
    api.get<{ forms: FormSummary[] }>('/forms/forms', { params }),
  create:     (data: { title?: string }) =>
    api.post<{ form: Form }>('/forms/forms', data),
  get:        (id: string) =>
    api.get<{ form: Form; questions: Question[] }>(`/forms/forms/${id}`),
  update:     (id: string, data: Partial<{ title: string; description: string | null; theme: Partial<FormTheme>; settings: Partial<FormSettings> }>) =>
    api.patch<{ form: Form }>(`/forms/forms/${id}`, data),
  trash:      (id: string) =>
    api.post<{ ok: boolean }>(`/forms/forms/${id}/trash`),
  restore:    (id: string) =>
    api.post<{ ok: boolean }>(`/forms/forms/${id}/restore`),
  delete:     (id: string) =>
    api.delete<{ ok: boolean }>(`/forms/forms/${id}/delete`),
  duplicate:  (id: string) =>
    api.post<{ form: Form }>(`/forms/forms/${id}/duplicate`),
  publish:    (id: string, publish: boolean) =>
    api.post<{ published: boolean }>(`/forms/forms/${id}/publish`, { publish }),

  // Questions
  listQuestions:     (formId: string) =>
    api.get<{ questions: Question[] }>(`/forms/forms/${formId}/questions`),
  createQuestion:    (formId: string, data: { question_type?: string; title?: string; position?: number }) =>
    api.post<{ question: Question }>(`/forms/forms/${formId}/questions`, data),
  updateQuestion:    (formId: string, qid: string, data: Partial<Question>) =>
    api.patch<{ question: Question }>(`/forms/forms/${formId}/questions/${qid}`, data),
  deleteQuestion:    (formId: string, qid: string) =>
    api.delete<{ ok: boolean }>(`/forms/forms/${formId}/questions/${qid}`),
  reorderQuestions:  (formId: string, items: Array<{ id: string; position: number }>) =>
    api.patch<{ ok: boolean }>(`/forms/forms/${formId}/questions/reorder`, items),
  duplicateQuestion: (formId: string, qid: string) =>
    api.post<{ question: Question }>(`/forms/forms/${formId}/questions/${qid}/duplicate`),

  // Réponses
  listResponses: (formId: string, params?: { limit?: number; offset?: number }) =>
    api.get<{ responses: FormResponse[]; total: number }>(`/forms/forms/${formId}/responses`, { params }),
  getResponse:   (formId: string, rid: string) =>
    api.get<{ response: FormResponse; answers: Answer[] }>(`/forms/forms/${formId}/responses/${rid}`),
  deleteResponse: (formId: string, rid: string) =>
    api.delete<{ ok: boolean }>(`/forms/forms/${formId}/responses/${rid}`),
  deleteAllResponses: (formId: string) =>
    api.delete<{ deleted: number }>(`/forms/forms/${formId}/responses`),

  // Analytics
  analytics:          (formId: string) =>
    api.get<{ total_responses: number; avg_fill_duration_secs: number | null; last_response_at: string | null }>(`/forms/forms/${formId}/analytics`),
  questionStats:      (formId: string) =>
    api.get<{ stats: QuestionStat[] }>(`/forms/forms/${formId}/analytics/questions`),

  // Export
  exportCsvUrl: (formId: string) => `/api/v1/forms/forms/${formId}/export/csv`,

  // Logique conditionnelle
  listRules:   (formId: string) =>
    api.get<{ rules: ConditionalRule[] }>(`/forms/forms/${formId}/rules`),
  createRule:  (formId: string, data: Omit<ConditionalRule, 'id' | 'form_id' | 'position' | 'created_at'>) =>
    api.post<{ rule: ConditionalRule }>(`/forms/forms/${formId}/rules`, data),
  deleteRule:  (formId: string, rid: string) =>
    api.delete<{ ok: boolean }>(`/forms/forms/${formId}/rules/${rid}`),
}

// Public API (sans auth)
export const publicFormsApi = {
  getForm: (token: string) =>
    api.get<{ form: unknown }>(`/forms/public/${token}`),
  status: (token: string) =>
    api.get<{ status: 'open' | 'closed' | 'expired' | 'full'; response_count?: number }>(`/forms/public/${token}/status`),
  submit: (token: string, data: {
    answers: AnswerInput[]
    respondent_email?: string
    respondent_name?: string
    fill_duration_secs?: number
  }) =>
    api.post<{ ok: boolean; response_id: string; confirmation: string }>(`/forms/public/${token}/submit`, data),
}
