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

export type LifeEventId =
  | 'relocation-identity'
  | 'marriage-family'
  | 'birth-parenthood'
  | 'employment-career'
  | 'starting-business'

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
  life_events: LifeEventId[]
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

export type ProcessState = 'not_started' | 'started' | 'submitted' | 'completed'
export type DocumentState = 'available' | 'expired' | 'invalid' | 'unsure'
/** A held document the citizen reports as not usable. */
export type ProblemState = Exclude<DocumentState, 'available'>

export interface PlanRequest {
  target_service_ids: string[]
  owned_document_ids: string[]
  /** User-reported completions. */
  completed_service_ids: string[]
  /** Started/submitted processes, reported by the citizen. */
  progress?: Record<string, ProcessState>
  /** Held documents the citizen marked unusable (only "available" satisfies). */
  document_states?: Record<string, DocumentState>
  /** State/UT the citizen lives in, if known. */
  state?: string | null
}

export type StepRole = 'target' | 'prerequisite' | 'acquisition'
export type StepStatus = 'ready' | 'waiting' | 'blocked' | 'in_progress'
export type RequirementState = 'satisfied' | 'pending_acquisition' | 'missing' | 'not_provided'

export interface Dependency {
  service_id: string
  reason: 'prerequisite' | 'acquisition'
  document_id: string | null
  requirement_id: string | null
  evidence_ids: string[]
  acceptance_evidence_ids?: string[]
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
  unusable_document_ids?: string[]
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
  process_state?: ProcessState
  authority?: string
  region?: string | null
  /** Completion condition: verified documents the service issues when done. */
  completion_document_ids?: string[]
  completion_evidence_ids?: string[]
}

export interface Blocker {
  code: 'missing_document_no_route' | 'missing_document_route_outside_jurisdiction' | 'dependency_blocked'
  service_id: string
  message: string
  requirement_id: string | null
  document_options: string[]
  blocked_by_service_ids: string[]
  route_service_ids?: string[]
  evidence_ids?: string[]
}

export interface ReasonOut {
  code: 'unblocks_downstream' | 'ready_independent' | 'resolve_blocker' | 'await_in_progress' | 'all_complete'
  message: string
  unblocks: string[]
  parallel_with: string[]
  documents_used: string[]
  document_options: string[]
  evidence_ids?: string[]
}

export interface NextAction {
  type: 'start_service' | 'obtain_document' | 'follow_up' | 'none'
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
  completed?: { service_id: string; source: 'user_reported' | 'official'; output_document_ids: string[] }[]
  progress?: ProgressSummary | null
  document_summary?: DocumentSummary | null
  notices?: { code: string; service_id: string; message: string; related_service_ids: string[] }[]
  clarifications?: { code: 'state_required'; service_id: string; region: string | null }[]
  citizen_state?: string | null
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

export interface ProgressSummary {
  total_services: number
  completed: number
  completed_user_reported: number
  completed_verified: number
  in_progress: number
  ready: number
  waiting: number
  blocked: number
}

export interface DocumentSummary {
  mandatory_requirements: number
  satisfied: number
  will_be_produced: number
  missing: number
  unusable: { document_id: string; state: DocumentState }[]
}

export type CitizenGoal = 'update-address' | 'update-name-after-marriage' | 'register-marriage' | 'enrol-child-aadhaar' | 'get-pan'

export interface CitizenContext {
  goals: string[]
  life_events: string[]
  state: string | null
  held_document_ids: string[]
  lacking_document_ids: string[]
  completed_service_ids: string[]
}

export interface DiscoveryCandidate {
  service_id: string
  status: 'included' | 'needs_clarification' | 'excluded' | 'completed'
  matched_goals: string[]
  matched_life_events: string[]
  region: string | null
  exclusion: 'outside_verified_jurisdiction' | 'lacks_required_record' | null
  record_document_ids: string[]
}

export interface DiscoverResponse {
  generated_by: string
  state: string | null
  candidates: DiscoveryCandidate[]
  clarifications: { code: 'goal_required' | 'state_required' | 'record_held'; service_ids: string[]; document_ids: string[] }[]
  recommended_target_ids: string[]
  services: Record<string, DisplayName>
  documents: Record<string, DisplayName & { category: DocumentCategory }>
}

export interface Vocabulary {
  goals: CitizenGoal[]
  life_events: LifeEventId[]
  states: string[]
}

export interface SituationInterpretation {
  generated_by: 'ai'
  label: string
  model: string
  goals: string[]
  life_events: string[]
  state: string | null
  held_document_ids: string[]
  lacking_document_ids: string[]
  /** Held documents the citizen said are expired / invalid / unsure about. */
  document_states?: Record<string, Exclude<DocumentState, 'available'>>
  completed_service_ids: string[]
  /** Services the citizen explicitly asked for (validated ids). */
  requested_service_ids?: string[]
  /** When moving: the state they are leaving (services follow `state`). */
  origin_state?: string | null
  unknowns: string[]
  dropped: string[]
  /** Signed in: facts the account already had (shown, not asked again). */
  account_state?: string | null
  account_document_ids?: string[]
  /** Deterministic (not AI): a topic the text names when no goal/service was understood, and the
   * curated services for it (e.g. "passport" -> the two passport reissue services). */
  topic?: string | null
  topic_service_ids?: string[]
}

export interface ProposeRequest {
  context: CitizenContext
  document_states: Record<string, DocumentState>
  progress: Record<string, ProcessState>
  /** The citizen's edited outcome list; null = use discovery's recommendation. */
  target_service_ids: string[] | null
  requested_service_ids?: string[]
}

export interface SupportingService {
  service_id: string
  role: 'prerequisite' | 'acquisition'
  for_service_ids: string[]
  document_ids: string[]
}

/** Deterministic discovery + planner output for a reviewed situation. A proposal until accepted. */
export interface ProposalResponse {
  generated_by: 'deterministic-discovery+planner'
  status: 'ready' | 'needs_clarification' | 'no_supported_services' | 'no_services_selected'
  discovery: DiscoverResponse
  target_service_ids: string[]
  supporting: SupportingService[]
  plan: PlanResponse | null
  uncovered_goals: string[]
  uncovered_life_events: string[]
  /** What happened to each service the citizen explicitly asked for. */
  requested?: { service_id: string; outcome: 'target' | 'completed' | 'outside_jurisdiction' | 'unknown' }[]
  /** Other discovered services relevant to the situation (not planned unless added). */
  suggested_service_ids?: string[]
  /** Every requirement and dependency cites official evidence (checked server-side). */
  grounding?: Grounding | null
}

export interface Grounding {
  requirements: number
  requirements_grounded: number
  dependencies: number
  dependencies_grounded: number
  ungrounded: string[]
}

/** Signed in: the reviewed situation; account facts are added on the server. */
export interface AccountProposeRequest {
  goals: string[]
  life_events: string[]
  state: string | null
  held_document_ids: string[]
  document_states: Record<string, 'expired' | 'invalid' | 'unsure'>
  lacking_document_ids: string[]
  reported_completed_service_ids: string[]
  requested_service_ids: string[]
  target_service_ids: string[] | null
  /** Where `state` came from (a profile state is sent as `state: null`). */
  state_source?: 'description' | 'manual'
}

export interface AccountProposal {
  proposal: ProposalResponse
  account_context: {
    state: string | null
    state_source: 'description' | 'manual' | 'profile' | 'none'
    profile_state: string | null
    city: string | null
    vault: Record<string, 'valid' | 'expired' | 'invalid' | 'unsure'>
    documents_from_description: string[]
    completed_service_ids: string[]
    reported_completed_service_ids: string[]
    in_progress: Record<string, string>
  }
  existing_plans: { plan_id: string; title: string | null; target_service_ids: string[]; overlapping_service_ids: string[]; covers_all: boolean }[]
  recommendation: 'new' | 'extend' | 'covered' | 'none'
  recommended_plan_id: string | null
}

/** The signed-in citizen's profile (`/api/me/profile`; user id comes from the verified token). */
export interface Profile {
  user_id: string
  email: string | null
  full_name: string | null
  state: string | null
  city: string | null
  preferred_language: 'en' | 'hi'
  created_at: string
  updated_at: string
}

export type ProfileUpdate = Partial<Pick<Profile, 'full_name' | 'state' | 'city' | 'preferred_language'>>

// ---- signed-in account data (`/api/me/*`; the owner always comes from the verified token)

/** The citizen's OWN assessment. GovPath never verifies documents officially. */
export type VaultStatus = 'valid' | 'expired' | 'invalid' | 'unsure'

export interface VaultDocument {
  id: string
  document_type: string
  name: string | null
  name_hi: string | null
  status: VaultStatus
  /** What the planner uses: "expired" when a "valid" document's expiry date has passed. */
  effective_status: VaultStatus
  expiry_passed: boolean
  label: string | null
  issue_date: string | null
  expiry_date: string | null
  note: string | null
  used_by_plan_ids: string[]
  created_at: string
  updated_at: string
}

export interface VaultDocumentInput {
  document_type?: string
  status?: VaultStatus
  label?: string | null
  issue_date?: string | null
  expiry_date?: string | null
  note?: string | null
}

export interface PlanChange {
  plan_id: string
  title: string | null
  steps: { service_id: string; before: string | null; after: string | null }[]
  blockers_added: string[]
  blockers_removed: string[]
  next_action_changed: boolean
}

export interface DocumentWriteResult {
  document: VaultDocument | null
  plan_changes: PlanChange[]
}

export interface SavedPlanSummary {
  id: string
  title: string | null
  status: 'active' | 'archived'
  target_service_ids: string[]
  citizen_state: string | null
  /** The citizen's goals (set for situation-based plans); used for display names. */
  goals?: string[]
  service_names: Record<string, { name: string; name_hi: string | null }>
  total_services: number
  completed: number
  blocked: number
  ready: number
  next_action: { type: string; service_id: string | null } | null
  evaluation_error: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface SavedPlan extends SavedPlanSummary {
  evaluated_at: string | null
  /** The deterministic planner's last output (same shape as POST /api/workflows/plan). */
  plan: PlanResponse | null
  document_refs: { document_type: string; vault_document_ids: string[]; requirement_ids: string[] }[]
  created_document_ids: string[]
  plan_changes: PlanChange[]
  /** "repeat_request": this submission had already created the plan (no copy made). */
  deduplicated?: 'repeat_request' | null
}

export interface HeldDocument {
  document_type: string
  status: VaultStatus
}

export interface SavedPlanInput {
  title?: string | null
  target_service_ids?: string[]
  goals?: string[]
  state?: string | null
  held_documents?: HeldDocument[]
  source?: 'proposal' | 'import' | 'planner'
  /** One id per submission: a repeated submission returns the plan already created. */
  client_request_id?: string
  progress?: Record<string, 'started' | 'submitted' | 'completed'>
}

export interface ActivityEvent {
  id: number
  event_type:
    | 'document_added'
    | 'document_updated'
    | 'document_removed'
    | 'document_expired'
    | 'plan_created'
    | 'plan_updated'
    | 'plan_archived'
    | 'plan_restored'
    | 'plan_deleted'
    | 'plan_recalculated'
    | 'progress_changed'
  entity_type: 'document' | 'plan' | 'service'
  entity_id: string | null
  details: Record<string, unknown>
  created_at: string
}

export interface Dashboard {
  today: string
  full_name: string | null
  state: string | null
  city: string | null
  preferred_language: 'en' | 'hi'
  plans: SavedPlanSummary[]
  next_actions: { plan_id: string; plan_title: string | null; type: string; service_id: string | null; reason_code: string; document_options: string[] }[]
  blockers: {
    plan_id: string
    plan_title: string | null
    code: string
    service_id: string
    requirement_id: string | null
    document_options: string[]
    blocked_by_service_ids: string[]
  }[]
  progress: Record<string, 'started' | 'submitted' | 'completed'>
  vault_counts: Record<VaultStatus, number>
  vault_total: number
  expiring_soon: VaultDocument[]
  expired: VaultDocument[]
  recent_activity: ActivityEvent[]
}
