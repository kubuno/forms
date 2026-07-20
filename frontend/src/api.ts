import { api } from '@kubuno/sdk'

// ── Types ────────────────────────────────────────────────────────────────────

export interface FormTheme {
  primaryColor:     string
  headerColor:      string
  fontFamily:       string
  backgroundImage:  string | null
  backgroundColor?: string | null
  font?:            string
  style:            'default' | 'classic' | 'playful'
}

/** How the public form is presented to respondents. */
export type DisplayMode = 'classic' | 'one_at_a_time'

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
  // v2
  displayMode?:          DisplayMode
  quizMode?:             boolean
  showResultImmediately?: boolean
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
  | 'linear_scale' | 'rating' | 'opinion_scale'
  | 'yes_no'
  | 'email' | 'number' | 'phone' | 'url'
  | 'date' | 'time'
  | 'ranking'
  | 'file_upload' | 'signature' | 'image' | 'video'
  | 'grid_radio' | 'grid_checkbox'
  | 'statement' | 'welcome_screen' | 'thank_you_screen'
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

export type RuleOperator =
  | 'equals' | 'not_equals' | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with'
  | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal'
  | 'is_empty' | 'is_not_empty'

export type RuleAction =
  | 'show_section' | 'hide_section' | 'go_to_section' | 'skip_to_question'
  | 'jump_to_thankyou' | 'submit_form'

export interface ConditionalRule {
  id:                  string
  form_id:             string
  position:            number
  trigger_question_id: string
  operator:            RuleOperator
  compare_value:       unknown
  action:              RuleAction
  target_section_id:   string | null
  created_at:          string
}

/** Per-question quiz outcome returned by the public submit endpoint. */
export interface QuizDetail {
  question_id:   string
  is_correct:    boolean
  points_earned: number
  points:        number
  feedback:      string | null
}

export interface QuizResult {
  score:     number
  max_score: number
  details:   QuizDetail[]
}

/** File descriptor stored as the answer value for file_upload questions. */
export interface UploadedFile {
  fileId:      string
  name:        string
  size:        number
  contentType: string | null
}

/** Question shape returned by the public endpoint (no quiz answers leaked). */
export interface PublicQuestion {
  id:            string
  position:      number
  question_type: QuestionType
  title:         string
  description:   string | null
  required:      boolean
  image_path:    string | null
  options:       Record<string, unknown>
}

export interface PublicForm {
  id:          string
  title:       string
  description: string | null
  theme:       FormTheme
  header_image_path: string | null
  settings: {
    collectEmail:          boolean
    showProgressBar:       boolean
    confirmationMessage:   string
    requireSignIn:         boolean
    displayMode:           DisplayMode | null
    quizMode:              boolean | null
    showResultImmediately: boolean | null
    shuffleQuestions:      boolean | null
  }
  questions: PublicQuestion[]
  rules:     ConditionalRule[]
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
  uploadDownloadUrl: (formId: string, fileId: string) =>
    `/api/v1/forms/forms/${formId}/uploads/${fileId}`,

  // Form header image (banner)
  uploadHeader: (formId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ headerImagePath: string }>(`/forms/forms/${formId}/header`, fd)
  },
  deleteHeader: (formId: string) =>
    api.delete<void>(`/forms/forms/${formId}/header`),
  /** The banner is served through the form's PUBLIC token (it is public content). */
  headerImageUrl: (publicToken: string, bust?: string | null) =>
    `/api/v1/forms/public/${publicToken}/header${bust ? `?v=${encodeURIComponent(bust)}` : ''}`,

  /** Upload an image into the form's own storage; the URL is publicly readable. */
  uploadImage: (formId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ url: string; name: string }>(`/forms/forms/${formId}/images`, fd)
  },

  // Question import from another form
  importQuestions: (formId: string, sourceFormId: string, questionIds: string[]) =>
    api.post<{ imported: number }>(`/forms/forms/${formId}/questions/import`,
      { source_form_id: sourceFormId, question_ids: questionIds }),

  // Logique conditionnelle
  listRules:   (formId: string) =>
    api.get<{ rules: ConditionalRule[] }>(`/forms/forms/${formId}/rules`),
  createRule:  (formId: string, data: Omit<ConditionalRule, 'id' | 'form_id' | 'position' | 'created_at'>) =>
    api.post<{ rule: ConditionalRule }>(`/forms/forms/${formId}/rules`, data),
  updateRule:  (formId: string, rid: string, data: Partial<Pick<ConditionalRule, 'operator' | 'compare_value' | 'action' | 'target_section_id'>>) =>
    api.patch<{ rule: ConditionalRule }>(`/forms/forms/${formId}/rules/${rid}`, data),
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
    api.post<{ ok: boolean; response_id: string; confirmation: string; result: QuizResult | null }>(`/forms/public/${token}/submit`, data),
  upload: (token: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<UploadedFile>(`/forms/public/${token}/upload`, fd)
  },
}
