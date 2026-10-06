export type RiskLevel = "high" | "medium" | "low";
export type AlertStatus = "new" | "triage" | "linked" | "dismissed";
export type CaseStatus =
  | "investigating"
  | "pending_review"
  | "supplement"
  | "closed";
export type EvidenceStrength = "strong" | "medium" | "weak";
export type NodeKind = "account" | "device" | "ip" | "merchant";
export type EdgeKind = "transfer" | "shared_device" | "shared_ip" | "payee";
export type CaseDisposition = "freeze" | "release" | "observe";
export type ConclusionStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "returned"
  | "snapshot";

export interface Alert {
  id: string;
  title: string;
  account: string;
  counterparty: string;
  channel: string;
  amount: number;
  riskLevel: RiskLevel;
  score: number;
  status: AlertStatus;
  detectedAt: string;
  tags: string[];
  deviceId: string;
  ip: string;
  caseId?: string;
  /** 首次归属的案件；并案迁移后保留最初来源，用于审计与升级补录 */
  originCaseId?: string;
}

export interface GraphNodeData {
  label: string;
  kind: NodeKind;
  riskLevel: RiskLevel;
  note: string;
  evidenceStrength: EvidenceStrength;
  source: string;
  occurredAt: string;
}

export interface InvestigationNode {
  id: string;
  caseId: string;
  position: { x: number; y: number };
  data: GraphNodeData;
  /** 首次归属的案件；并案迁移后保留最初来源 */
  originCaseId?: string;
}

export interface InvestigationEdge {
  id: string;
  caseId: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string;
  amount?: number;
  occurredAt: string;
  explanation: string;
  /** 首次归属的案件；并案迁移后保留最初来源 */
  originCaseId?: string;
}

export interface Evidence {
  id: string;
  caseId: string;
  title: string;
  source: string;
  strength: EvidenceStrength;
  occurredAt: string;
  submittedAt: string;
  submittedBy: string;
  attachment: string;
  note: string;
  version: number;
  /** 首次归属的案件；并案迁移后保留最初来源 */
  originCaseId?: string;
}

export interface ConclusionVersion {
  id: string;
  caseId: string;
  version: number;
  status: ConclusionStatus;
  disposition: CaseDisposition;
  rationale: string;
  riskControls: string[];
  createdBy: string;
  createdAt: string;
  reviewer: string;
  reviewerNote?: string;
  /** 首次归属的案件；并案迁移后保留最初来源 */
  originCaseId?: string;
  /** 复核留痕快照：仅在并案时由已提交复核的版本生成 */
  snapshotOf?: string;
  /** 快照来源案件与原始版本号 */
  snapshotFromCaseId?: string;
  snapshotFromVersion?: number;
  /** 快照生成前的结论状态（submitted / approved / returned） */
  snapshotFromStatus?: Exclude<ConclusionStatus, "draft" | "snapshot">;
}

export interface InvestigationCase {
  id: string;
  title: string;
  status: CaseStatus;
  riskLevel: RiskLevel;
  owner: string;
  openedAt: string;
  updatedAt: string;
  summary: string;
  alertIds: string[];
  nextReviewAt: string;
  /** 工作区版本号：任何改动自增，并案确认时用于乐观并发校验 */
  revision: number;
  /** 并案后指向目标案件；同时案件被标记为 closed */
  mergedIntoCaseId?: string;
}

export interface AuditLog {
  id: string;
  caseId?: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface AlertFilters {
  keyword: string;
  riskLevel: RiskLevel | "all";
  status: AlertStatus | "all";
  channel: string;
}

export interface CaseWorkspace {
  case: InvestigationCase;
  nodes: InvestigationNode[];
  edges: InvestigationEdge[];
  evidence: Evidence[];
  conclusions: ConclusionVersion[];
}

export interface DashboardSummary {
  newAlerts: number;
  highRiskAlerts: number;
  activeCases: number;
  pendingReview: number;
  totalExposure: number;
  caseStatusCounts: Record<CaseStatus, number>;
  riskCounts: Record<RiskLevel, number>;
}
