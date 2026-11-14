// Mirrors backend/app/schemas/{health,knowledge,workflow}.py. Public ids are stable slugs.

export interface HealthResponse {
  status: 'ok'
  app: string
  version: string
}

export interface DbHealthResponse {
  status: 'ok' | 'unconfigured' | 'error'
  database: string
  pgvector: boolean | null
  detail: string | null
}

export type VerificationStatus = 'verified' | 'unverified' | 'needs_review' | 'rejected'
export type RequirementType = 'mandatory' | 'optional' | 'conditional'

export interface Evidence {
  id: string
  excerpt: string
  locator: string | null
  note: string | null
  source_url: string
  source_title: string | null
  source_authority: string | null
  verification_status: VerificationStatus
  verified_at: string | null
}

export interface ServiceSummary {
  id: string
  name: string
  name_hi: string | null
  description: string
  description_hi: string | null
  authority: string
  jurisdiction: 'national' | 'state'
  state: string | null
  category: string
  application_form: string | null
  official_info_url: string
  application_url: string | null
  last_verified_at: string | null
  requirement_count: number
  mandatory_requirement_count: number
  verified_requirement_count: number
}

export interface DocumentOption {
  document_id: string
  document_name: string
  document_name_hi: string | null
  notes: string | null
  evidence: Evidence | null
}

export interface Requirement {
  id: string
  name: string
  name_hi: string | null
  description: string | null
  requirement_type: RequirementType
  is_alternative_group: boolean
  condition: string | null
  notes: string | null
  verification_status: VerificationStatus
  options: DocumentOption[]
  evidence: Evidence[]
}

export interface ServiceDetail extends ServiceSummary {
  verification_notes: string | null
  requirements: Requirement[]
  outputs: { document_id: string; document_name: string; document_name_hi: string | null; evidence: Evidence | null }[]
  prerequisites: {
    service_id: string
    service_name: string
    service_name_hi: string | null
    verification_status: VerificationStatus
    notes: string | null
    evidence: Evidence
  }[]
  evidence: Evidence[]
}

export type DocumentCategory =
  | 'identity'
  | 'address_proof'
  | 'existing_record'
  | 'vehicle'
  | 'financial'
  | 'other'

export interface DocumentType {
  id: string
  name: string
  name_hi: string | null
  description: string | null
  category: DocumentCategory
  issued_by_service_ids: string[]
  accepted_by_service_ids: string[]
}

// ---- workflow planning

export interface PlanRequest {
  target_service_ids: string[]
  owned_document_ids: string[]
  completed_service_ids: string[]
}

export type StepRole = 'target' | 'prerequisite' | 'acquisition'
export type StepStatus = 'ready' | 'waiting' | 'blocked'
export type RequirementState = 'satisfied' | 'pending_acquisition' | 'missing' | 'not_provided'

export interface Dependency {
  service_id: string
  reason: 'prerequisite' | 'acquisition'
  document_id: string | null
  requirement_id: string | null
  evidence_ids: string[]
}

export interface RequirementStatus {
  requirement_id: string
  service_id: string
  name: string
  kind: RequirementType
  state: RequirementState
  document_options: string[]
  is_alternative_group: boolean
  satisfied_by_document_id: string | null
  acquired_via_service_id: string | null
  acquired_document_id: string | null
  condition: string | null
  notes: string | null
  evidence_ids: string[]
}

export interface PlanStep {
  step_number: number
  stage: number
  service_id: string
  service_name: string
  role: StepRole
  status: StepStatus
  depends_on: Dependency[]
  unblocks: string[]
  requirements: RequirementStatus[]
  evidence_ids: string[]
}

export interface Blocker {
  code: 'missing_document_no_route' | 'dependency_blocked'
  service_id: string
  message: string
  requirement_id: string | null
  document_options: string[]
  blocked_by_service_ids: string[]
}

export interface ReasonOut {
  code: 'unblocks_downstream' | 'ready_independent' | 'resolve_blocker' | 'all_complete'
  message: string
  unblocks: string[]
  parallel_with: string[]
  documents_used: string[]
  document_options: string[]
}

export interface NextAction {
  type: 'start_service' | 'obtain_document' | 'none'
  reason: ReasonOut
  service_id: string | null
  requirement_id: string | null
  document_options: string[]
}

export interface EvidenceRef {
  id: string
  source_url: string
  source_title: string | null
  excerpt: string
  locator: string | null
  verified_at: string | null
}

export interface DisplayName {
  name: string
  name_hi: string | null
}

export interface PlanResponse {
  generated_by: string
  selected_service_ids: string[]
  completed_service_ids: string[]
  steps: PlanStep[]
  parallel_groups: string[][]
  required_documents: RequirementStatus[]
  satisfied_requirements: RequirementStatus[]
  missing_documents: {
    requirement_id: string
    service_id: string
    document_options: string[]
    acquisition_service_id: string | null
  }[]
  optional_documents: RequirementStatus[]
  prerequisite_services: Dependency[]
  acquisition_routes: {
    service_id: string
    document_id: string
    for_service_id: string
    for_requirement_id: string
    evidence_ids: string[]
  }[]
  blockers: Blocker[]
  next_action: NextAction
  evidence: EvidenceRef[]
  services: Record<string, DisplayName>
  requirements: Record<string, DisplayName>
  documents: Record<string, DisplayName & { category: DocumentCategory }>
}

export interface ApiErrorDetail {
  code?: string
  message?: string
  unknown_service_ids?: string[]
  unknown_document_ids?: string[]
}

// ---- assistant (AI-generated explanations; never verified facts)

export interface AssistantQuery {
  question: string
  language?: 'en' | 'hi'
  workflow?: PlanRequest
}

export interface Citation {
  id: string
  kind: 'official_excerpt' | 'verified_fact'
  excerpt: string
  source_url: string
  source_title: string | null
  source_authority: string | null
  source_verified: boolean
  page_start: number | null
  page_end: number | null
  section: string | null
  locator: string | null
  similarity: number | null
  evidence_ids: string[]
}

export type EvidenceStatus = 'sufficient' | 'partial' | 'insufficient' | 'conflicting'

export interface AssistantAnswer {
  answer: string
  language: 'en' | 'hi'
  generated_by: 'ai' | 'none'
  label: string
  model: string | null
  evidence_status: EvidenceStatus
  citations: Citation[]
  retrieval_confidence: 'none' | 'low' | 'high'
  best_similarity: number | null
  cached: boolean
  workflow: {
    generated_by: 'deterministic-planner'
    next_action: NextAction
    steps: { service_id: string; status: StepStatus; stage: number; role: StepRole }[]
  } | null
}
