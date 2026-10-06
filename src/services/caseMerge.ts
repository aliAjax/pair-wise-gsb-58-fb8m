import type {
  Alert,
  CaseDisposition,
  ConclusionStatus,
  ConclusionVersion,
  EdgeKind,
  Evidence,
  InvestigationCase,
  InvestigationEdge,
  InvestigationNode,
  NodeKind,
  RiskLevel,
} from "../models/types";
import type { MockDatabase } from "./mockStorage";
import { appendAudit, createId } from "./mockStorage";

/** 当前本地数据库结构版本；旧版本数据在读取时自动升级 */
export const MERGE_SCHEMA_VERSION = 2;

export const nodeKindLabels: Record<NodeKind, string> = {
  account: "账户",
  device: "设备",
  ip: "IP 地址",
  merchant: "商户",
};

export const edgeKindLabels: Record<EdgeKind, string> = {
  transfer: "转账",
  shared_device: "共享设备",
  shared_ip: "共享 IP",
  payee: "收款方",
};

/* ------------------------------------------------------------------ */
/* 指纹：规范化 JSON 后做 FNV-1a，用于预览后并发修改检测                 */
/* ------------------------------------------------------------------ */

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const fingerprintOf = (entity: unknown): string =>
  fnv1aHex(stableStringify(entity));

/* ------------------------------------------------------------------ */
/* 类型定义                                                            */
/* ------------------------------------------------------------------ */

export interface EntitySig {
  id: string;
  fingerprint: string;
}

export interface CaseRevisionSnapshot {
  caseId: string;
  revision: number;
  caseFingerprint: string;
  alertFingerprint: string;
  nodeFingerprint: string;
  edgeFingerprint: string;
  evidenceFingerprint: string;
  conclusionFingerprint: string;
  alerts: EntitySig[];
  nodes: EntitySig[];
  edges: EntitySig[];
  evidence: EntitySig[];
  conclusions: EntitySig[];
}

export interface MergeToken {
  schemaVersion: number;
  sourceCaseId: string;
  targetCaseId: string;
  issuedAt: string;
  source: CaseRevisionSnapshot;
  target: CaseRevisionSnapshot;
}

export type MergeEntityType =
  | "case"
  | "alert"
  | "node"
  | "edge"
  | "evidence"
  | "conclusion";

export interface MergeConflict {
  side: "source" | "target";
  entity: MergeEntityType;
  kind: "added" | "removed" | "modified" | "revision";
  entityId?: string;
  label?: string;
  detail: string;
}

export class MergeConflictError extends Error {
  conflicts: MergeConflict[];

  constructor(conflicts: MergeConflict[]) {
    super("并案确认已过期，案件在预览后发生变化。");
    this.name = "MergeConflictError";
    this.conflicts = conflicts;
  }
}

export interface AlertMergePlanItem {
  alertId: string;
  title: string;
  account: string;
  riskLevel: RiskLevel;
  action: "migrate";
}

export interface NodeMergePlanItem {
  nodeId: string;
  label: string;
  kind: NodeKind;
  riskLevel: RiskLevel;
  action: "reuse" | "create";
  targetNodeId?: string;
}

export interface EdgeMergePlanItem {
  edgeId: string;
  label: string;
  kind: EdgeKind;
  action: "reuse" | "migrate";
  targetEdgeId?: string;
  sourceNodeLabel: string;
  targetNodeLabel: string;
  amount?: number;
}

export interface EvidenceMergePlanItem {
  evidenceId: string;
  title: string;
  strength: Evidence["strength"];
  action: "migrate";
}

export interface ConclusionMergePlanItem {
  conclusionId: string;
  version: number;
  status: ConclusionStatus;
  disposition: CaseDisposition;
  action: "migrate" | "snapshot";
  /** 草稿并入后在目标案件中的新版本号 */
  targetVersion?: number;
}

export interface MergePlan {
  alerts: AlertMergePlanItem[];
  nodes: NodeMergePlanItem[];
  edges: EdgeMergePlanItem[];
  evidence: EvidenceMergePlanItem[];
  conclusions: ConclusionMergePlanItem[];
}

export interface CaseMergePreview {
  sourceCase: InvestigationCase;
  targetCase: InvestigationCase;
  plan: MergePlan;
  token: MergeToken;
}

export interface CaseMergeResult {
  sourceCaseId: string;
  targetCaseId: string;
  movedAlertIds: string[];
  nodeCreated: number;
  nodesReused: number;
  edgesMigrated: number;
  edgesReused: number;
  evidenceMoved: number;
  draftsMoved: number;
  snapshotted: number;
}

/* ------------------------------------------------------------------ */
/* 数据读取辅助                                                        */
/* ------------------------------------------------------------------ */

const normalizeLabel = (label: string): string => label.trim().toLowerCase();

/** 案件的实际告警集合：alertIds 与告警自身 caseId 取并集，兼容历史脏数据 */
export const getCaseAlerts = (
  database: MockDatabase,
  caseId: string,
): Alert[] => {
  const declared = new Set(
    database.cases.find((item) => item.id === caseId)?.alertIds ?? [],
  );
  database.alerts.forEach((alert) => {
    if (alert.caseId === caseId) {
      declared.add(alert.id);
    }
  });
  return database.alerts.filter((alert) => declared.has(alert.id));
};

const getNodes = (database: MockDatabase, caseId: string) =>
  database.nodes
    .filter((item) => item.caseId === caseId)
    .sort((a, b) => a.id.localeCompare(b.id));

const getEdges = (database: MockDatabase, caseId: string) =>
  database.edges
    .filter((item) => item.caseId === caseId)
    .sort((a, b) => a.id.localeCompare(b.id));

const getEvidence = (database: MockDatabase, caseId: string) =>
  database.evidence
    .filter((item) => item.caseId === caseId)
    .sort((a, b) => a.id.localeCompare(b.id));

const getConclusions = (database: MockDatabase, caseId: string) =>
  database.conclusions
    .filter((item) => item.caseId === caseId)
    .sort((a, b) => a.id.localeCompare(b.id));

const buildSnapshot = (
  database: MockDatabase,
  caseId: string,
): CaseRevisionSnapshot => {
  const alerts = getCaseAlerts(database, caseId);
  const nodes = getNodes(database, caseId);
  const edges = getEdges(database, caseId);
  const evidence = getEvidence(database, caseId);
  const conclusions = getConclusions(database, caseId);
  const investigationCase = database.cases.find(
    (item) => item.id === caseId,
  );

  return {
    caseId,
    revision: investigationCase?.revision ?? 0,
    caseFingerprint: fingerprintOf(investigationCase ?? null),
    alertFingerprint: fingerprintOf(alerts),
    nodeFingerprint: fingerprintOf(nodes),
    edgeFingerprint: fingerprintOf(edges),
    evidenceFingerprint: fingerprintOf(evidence),
    conclusionFingerprint: fingerprintOf(conclusions),
    alerts: alerts.map((item) => ({ id: item.id, fingerprint: fingerprintOf(item) })),
    nodes: nodes.map((item) => ({ id: item.id, fingerprint: fingerprintOf(item) })),
    edges: edges.map((item) => ({ id: item.id, fingerprint: fingerprintOf(item) })),
    evidence: evidence.map((item) => ({
      id: item.id,
      fingerprint: fingerprintOf(item),
    })),
    conclusions: conclusions.map((item) => ({
      id: item.id,
      fingerprint: fingerprintOf(item),
    })),
  };
};

/* ------------------------------------------------------------------ */
/* 预览：计算节点复用、关系复用、结论处置方式                           */
/* ------------------------------------------------------------------ */

const findReusableNode = (
  targetNodes: InvestigationNode[],
  sourceNode: InvestigationNode,
): InvestigationNode | undefined =>
  targetNodes.find(
    (target) =>
      target.id === sourceNode.id ||
      (target.data.kind === sourceNode.data.kind &&
        normalizeLabel(target.data.label) ===
          normalizeLabel(sourceNode.data.label)),
  );

const edgeMatches = (
  targetEdge: InvestigationEdge,
  resolvedSource: string,
  resolvedTarget: string,
  sourceEdge: InvestigationEdge,
): boolean => {
  if (targetEdge.id === sourceEdge.id) {
    return true;
  }
  const sameAmount =
    (targetEdge.amount ?? undefined) === (sourceEdge.amount ?? undefined);
  return (
    targetEdge.kind === sourceEdge.kind &&
    sameAmount &&
    ((targetEdge.source === resolvedSource &&
      targetEdge.target === resolvedTarget) ||
      (targetEdge.source === resolvedTarget &&
        targetEdge.target === resolvedSource))
  );
};

export function createMergePreview(
  database: MockDatabase,
  sourceCaseId: string,
  targetCaseId: string,
  issuedAt: string,
): CaseMergePreview {
  if (sourceCaseId === targetCaseId) {
    throw new Error("源案件与目标案件相同，无需并案。");
  }
  const sourceCase = database.cases.find((item) => item.id === sourceCaseId);
  const targetCase = database.cases.find((item) => item.id === targetCaseId);
  if (!sourceCase) {
    throw new Error("源案件不存在。");
  }
  if (!targetCase) {
    throw new Error("目标案件不存在。");
  }
  if (sourceCase.mergedIntoCaseId || targetCase.mergedIntoCaseId) {
    throw new Error("已并案的案件不能再次作为并案对象。");
  }

  const sourceAlerts = getCaseAlerts(database, sourceCaseId);
  const sourceNodes = getNodes(database, sourceCaseId);
  const sourceEdges = getEdges(database, sourceCaseId);
  const sourceEvidence = getEvidence(database, sourceCaseId);
  const sourceConclusions = getConclusions(database, sourceCaseId);
  const targetNodes = getNodes(database, targetCaseId);
  const targetEdges = getEdges(database, targetCaseId);

  // 节点：同名同类型则复用，否则新建
  const nodeMap = new Map<string, { action: "reuse" | "create"; targetId: string }>();
  const nodePlan: NodeMergePlanItem[] = sourceNodes.map((node) => {
    const reused = findReusableNode(targetNodes, node);
    if (reused) {
      nodeMap.set(node.id, { action: "reuse", targetId: reused.id });
      return {
        nodeId: node.id,
        label: node.data.label,
        kind: node.data.kind,
        riskLevel: node.data.riskLevel,
        action: "reuse",
        targetNodeId: reused.id,
      };
    }
    nodeMap.set(node.id, { action: "create", targetId: node.id });
    return {
      nodeId: node.id,
      label: node.data.label,
      kind: node.data.kind,
      riskLevel: node.data.riskLevel,
      action: "create",
    };
  });

  const nodeLabelById = (nodeId: string): string => {
    const sourceNode = sourceNodes.find((item) => item.id === nodeId);
    if (sourceNode) {
      return sourceNode.data.label;
    }
    const targetNode = targetNodes.find((item) => item.id === nodeId);
    return targetNode?.data.label ?? nodeId;
  };

  // 关系：端点先经过节点映射，再与目标案件现有关系比对
  const edgePlan: EdgeMergePlanItem[] = sourceEdges.map((edge) => {
    const sourceMapping = nodeMap.get(edge.source);
    const targetMapping = nodeMap.get(edge.target);
    const resolvedSource = sourceMapping?.targetId ?? edge.source;
    const resolvedTarget = targetMapping?.targetId ?? edge.target;
    const reused = targetEdges.find((target) =>
      edgeMatches(target, resolvedSource, resolvedTarget, edge),
    );
    return {
      edgeId: edge.id,
      label: edge.label,
      kind: edge.kind,
      amount: edge.amount,
      action: reused ? "reuse" : "migrate",
      targetEdgeId: reused?.id,
      sourceNodeLabel: nodeLabelById(edge.source),
      targetNodeLabel: nodeLabelById(edge.target),
    };
  });

  // 结论：草稿续号并入；已提交复核的版本仅保留快照
  let nextVersion = database.conclusions
    .filter((item) => item.caseId === targetCaseId && item.status !== "snapshot")
    .reduce((max, item) => Math.max(max, item.version), 0);
  const conclusionPlan: ConclusionMergePlanItem[] = sourceConclusions.map(
    (conclusion) => {
      if (conclusion.status === "draft") {
        nextVersion += 1;
        return {
          conclusionId: conclusion.id,
          version: conclusion.version,
          status: conclusion.status,
          disposition: conclusion.disposition,
          action: "migrate",
          targetVersion: nextVersion,
        };
      }
      return {
        conclusionId: conclusion.id,
        version: conclusion.version,
        status: conclusion.status,
        disposition: conclusion.disposition,
        action: "snapshot",
      };
    },
  );

  const plan: MergePlan = {
    alerts: sourceAlerts.map((alert) => ({
      alertId: alert.id,
      title: alert.title,
      account: alert.account,
      riskLevel: alert.riskLevel,
      action: "migrate",
    })),
    nodes: nodePlan,
    edges: edgePlan,
    evidence: sourceEvidence.map((item) => ({
      evidenceId: item.id,
      title: item.title,
      strength: item.strength,
      action: "migrate",
    })),
    conclusions: conclusionPlan,
  };

  const token: MergeToken = {
    schemaVersion: MERGE_SCHEMA_VERSION,
    sourceCaseId,
    targetCaseId,
    issuedAt,
    source: buildSnapshot(database, sourceCaseId),
    target: buildSnapshot(database, targetCaseId),
  };

  return { sourceCase, targetCase, plan, token };
}

/* ------------------------------------------------------------------ */
/* 确认校验：逐条列出预览后发生的变化                                   */
/* ------------------------------------------------------------------ */

const diffSignatures = (
  before: EntitySig[],
  after: EntitySig[],
  side: "source" | "target",
  entity: MergeEntityType,
  labelOf: (id: string) => string | undefined,
): MergeConflict[] => {
  const beforeMap = new Map(before.map((item) => [item.id, item.fingerprint]));
  const afterMap = new Map(after.map((item) => [item.id, item.fingerprint]));
  const conflicts: MergeConflict[] = [];
  const entityLabel: Record<MergeEntityType, string> = {
    case: "案件",
    alert: "告警",
    node: "图谱节点",
    edge: "关系",
    evidence: "证据",
    conclusion: "结论版本",
  };

  after.forEach((item) => {
    if (!beforeMap.has(item.id)) {
      conflicts.push({
        side,
        entity,
        kind: "added",
        entityId: item.id,
        label: labelOf(item.id),
        detail: `${side === "source" ? "源" : "目标"}案件新增${entityLabel[entity]}${
          labelOf(item.id) ? `「${labelOf(item.id)}」` : ""
        }。`,
      });
    } else if (beforeMap.get(item.id) !== item.fingerprint) {
      conflicts.push({
        side,
        entity,
        kind: "modified",
        entityId: item.id,
        label: labelOf(item.id),
        detail: `${side === "source" ? "源" : "目标"}案件${entityLabel[entity]}${
          labelOf(item.id) ? `「${labelOf(item.id)}」` : ""
        }在预览后被修改。`,
      });
    }
  });
  before.forEach((item) => {
    if (!afterMap.has(item.id)) {
      conflicts.push({
        side,
        entity,
        kind: "removed",
        entityId: item.id,
        label: labelOf(item.id),
        detail: `${side === "source" ? "源" : "目标"}案件${entityLabel[entity]}${
          labelOf(item.id) ? `「${labelOf(item.id)}」` : ""
        }在预览后被删除。`,
      });
    }
  });
  return conflicts;
};

export function detectMergeConflicts(
  database: MockDatabase,
  token: MergeToken,
): MergeConflict[] {
  const conflicts: MergeConflict[] = [];

  (["source", "target"] as const).forEach((side) => {
    const caseId = side === "source" ? token.sourceCaseId : token.targetCaseId;
    const snapshot = side === "source" ? token.source : token.target;
    const investigationCase = database.cases.find(
      (item) => item.id === caseId,
    );

    if (!investigationCase) {
      conflicts.push({
        side,
        entity: "case",
        kind: "removed",
        entityId: caseId,
        detail: `${side === "source" ? "源" : "目标"}案件 ${caseId} 已不存在。`,
      });
      return;
    }
    if (investigationCase.mergedIntoCaseId) {
      conflicts.push({
        side,
        entity: "case",
        kind: "modified",
        entityId: caseId,
        label: investigationCase.title,
        detail: `案件「${investigationCase.title}」已经并入其他案件。`,
      });
    }
    if (investigationCase.revision !== snapshot.revision) {
      conflicts.push({
        side,
        entity: "case",
        kind: "revision",
        entityId: caseId,
        label: investigationCase.title,
        detail: `案件「${investigationCase.title}」版本号由 V${snapshot.revision} 变为 V${investigationCase.revision}。`,
      });
    }

    if (fingerprintOf(investigationCase) !== snapshot.caseFingerprint) {
      conflicts.push({
        side,
        entity: "case",
        kind: "modified",
        entityId: caseId,
        label: investigationCase.title,
        detail: `案件「${investigationCase.title}」基础信息在预览后发生变化。`,
      });
    }

    const currentSnapshot = buildSnapshot(database, caseId);

    conflicts.push(
      ...diffSignatures(
        snapshot.alerts,
        currentSnapshot.alerts,
        side,
        "alert",
        (id) =>
          database.alerts.find((item) => item.id === id)?.title ??
          snapshot.alerts.find((item) => item.id === id)?.id,
      ),
      ...diffSignatures(
        snapshot.nodes,
        currentSnapshot.nodes,
        side,
        "node",
        (id) =>
          database.nodes.find((item) => item.id === id)?.data.label ??
          snapshot.nodes.find((item) => item.id === id)?.id,
      ),
      ...diffSignatures(
        snapshot.edges,
        currentSnapshot.edges,
        side,
        "edge",
        (id) =>
          database.edges.find((item) => item.id === id)?.label ??
          snapshot.edges.find((item) => item.id === id)?.id,
      ),
      ...diffSignatures(
        snapshot.evidence,
        currentSnapshot.evidence,
        side,
        "evidence",
        (id) =>
          database.evidence.find((item) => item.id === id)?.title ??
          snapshot.evidence.find((item) => item.id === id)?.id,
      ),
      ...diffSignatures(
        snapshot.conclusions,
        currentSnapshot.conclusions,
        side,
        "conclusion",
        (id) => {
          const conclusion = database.conclusions.find(
            (item) => item.id === id,
          );
          return conclusion
            ? `V${conclusion.version}`
            : snapshot.conclusions.find((item) => item.id === id)?.id;
        },
      ),
    );
  });

  return conflicts;
}

/* ------------------------------------------------------------------ */
/* 执行：直接改写传入的数据库副本；调用方保证冲突检测先通过             */
/* ------------------------------------------------------------------ */

const NODE_OFFSET = { x: 260, y: 140 };

export function applyCaseMerge(
  database: MockDatabase,
  token: MergeToken,
  atIso: string,
  actor = "林澜",
): CaseMergeResult {
  const { sourceCaseId, targetCaseId } = token;
  // 防御性校验：调用方应先检测冲突；存在冲突时绝不执行任何迁移
  const conflicts = detectMergeConflicts(database, token);
  if (conflicts.length > 0) {
    throw new MergeConflictError(conflicts);
  }
  const sourceCase = database.cases.find((item) => item.id === sourceCaseId);
  const targetCase = database.cases.find((item) => item.id === targetCaseId);
  if (!sourceCase || !targetCase) {
    throw new Error("案件不存在，无法并案。");
  }

  const sourceNodes = database.nodes.filter(
    (item) => item.caseId === sourceCaseId,
  );
  const targetNodes = database.nodes.filter(
    (item) => item.caseId === targetCaseId,
  );
  const sourceEdges = database.edges.filter(
    (item) => item.caseId === sourceCaseId,
  );
  const targetEdges = database.edges.filter(
    (item) => item.caseId === targetCaseId,
  );
  const sourceEvidence = database.evidence.filter(
    (item) => item.caseId === sourceCaseId,
  );
  const sourceConclusions = database.conclusions
    .filter((item) => item.caseId === sourceCaseId)
    .sort((a, b) => a.version - b.version);

  // 节点复用或新建
  const nodeIdMap = new Map<string, string>();
  let nodeCreated = 0;
  let nodesReused = 0;
  const offsetNodes = targetNodes.length > 0;
  sourceNodes.forEach((node) => {
    const reused = findReusableNode(targetNodes, node);
    if (reused) {
      nodeIdMap.set(node.id, reused.id);
      nodesReused += 1;
      return;
    }
    const newId = createId("NODE");
    const createdNode: InvestigationNode = {
      ...structuredClone(node),
      id: newId,
      caseId: targetCaseId,
      position: offsetNodes
        ? {
            x: node.position.x + NODE_OFFSET.x,
            y: node.position.y + NODE_OFFSET.y,
          }
        : node.position,
      originCaseId: node.originCaseId ?? sourceCaseId,
    };
    database.nodes.push(createdNode);
    targetNodes.push(createdNode);
    nodeIdMap.set(node.id, newId);
    nodeCreated += 1;
  });

  // 关系复用或迁移（端点改写到目标图谱节点）
  let edgesMigrated = 0;
  let edgesReused = 0;
  sourceEdges.forEach((edge) => {
    const resolvedSource = nodeIdMap.get(edge.source) ?? edge.source;
    const resolvedTarget = nodeIdMap.get(edge.target) ?? edge.target;
    const reused = targetEdges.find((item) =>
      edgeMatches(item, resolvedSource, resolvedTarget, edge),
    );
    if (reused) {
      edgesReused += 1;
      return;
    }
    const existingIds = new Set(database.edges.map((item) => item.id));
    const migratedEdge: InvestigationEdge = {
      ...structuredClone(edge),
      id: existingIds.has(edge.id) ? createId("E") : edge.id,
      caseId: targetCaseId,
      source: resolvedSource,
      target: resolvedTarget,
      originCaseId: edge.originCaseId ?? sourceCaseId,
    };
    database.edges.push(migratedEdge);
    edgesMigrated += 1;
  });

  // 证据整体迁入（保留原始版本号与提交记录）
  let evidenceMoved = 0;
  const usedEvidenceIds = new Set(database.evidence.map((item) => item.id));
  sourceEvidence.forEach((item) => {
    const newId = usedEvidenceIds.has(item.id) ? createId("EV") : item.id;
    usedEvidenceIds.add(newId);
    const moved: Evidence = {
      ...structuredClone(item),
      id: newId,
      caseId: targetCaseId,
      originCaseId: item.originCaseId ?? sourceCaseId,
    };
    database.evidence.push(moved);
    evidenceMoved += 1;
  });

  // 结论：草稿续号并入；其他版本只留只读快照
  let draftsMoved = 0;
  let snapshotted = 0;
  let nextVersion = database.conclusions
    .filter(
      (item) =>
        item.caseId === targetCaseId && item.status !== "snapshot",
    )
    .reduce((max, item) => Math.max(max, item.version), 0);
  const usedConclusionIds = new Set(
    database.conclusions.map((item) => item.id),
  );
  sourceConclusions.forEach((item) => {
    if (item.status === "draft") {
      nextVersion += 1;
      const newId = usedConclusionIds.has(item.id)
        ? createId("CV")
        : item.id;
      usedConclusionIds.add(newId);
      const moved: ConclusionVersion = {
        ...structuredClone(item),
        id: newId,
        caseId: targetCaseId,
        version: nextVersion,
        originCaseId: item.originCaseId ?? sourceCaseId,
      };
      database.conclusions.push(moved);
      draftsMoved += 1;
      return;
    }
    const snapshotId = createId("CV");
    usedConclusionIds.add(snapshotId);
    const snapshot: ConclusionVersion = {
      ...structuredClone(item),
      id: snapshotId,
      caseId: targetCaseId,
      status: "snapshot",
      originCaseId: item.originCaseId ?? sourceCaseId,
      snapshotOf: item.id,
      snapshotFromCaseId: sourceCaseId,
      snapshotFromVersion: item.version,
      snapshotFromStatus:
        item.status === "submitted" ||
        item.status === "approved" ||
        item.status === "returned"
          ? item.status
          : undefined,
    };
    database.conclusions.push(snapshot);
    snapshotted += 1;
  });

  // 告警归入目标案件
  const sourceAlertIds = new Set([
    ...sourceCase.alertIds,
    ...database.alerts
      .filter((item) => item.caseId === sourceCaseId)
      .map((item) => item.id),
  ]);
  const movedAlertIds: string[] = [];
  database.alerts = database.alerts.map((alert) => {
    if (!sourceAlertIds.has(alert.id)) {
      return alert;
    }
    movedAlertIds.push(alert.id);
    return {
      ...alert,
      caseId: targetCaseId,
      status: "linked" as const,
      originCaseId: alert.originCaseId ?? sourceCaseId,
    };
  });
  targetCase.alertIds = Array.from(
    new Set([...targetCase.alertIds, ...movedAlertIds]),
  );

  // 删除源案件残留工作区数据（节点/关系/证据/结论均已迁移或复用）
  database.nodes = database.nodes.filter(
    (item) => item.caseId !== sourceCaseId,
  );
  database.edges = database.edges.filter(
    (item) => item.caseId !== sourceCaseId,
  );
  database.evidence = database.evidence.filter(
    (item) => item.caseId !== sourceCaseId,
  );
  database.conclusions = database.conclusions.filter(
    (item) => item.caseId !== sourceCaseId,
  );

  targetCase.updatedAt = atIso;
  targetCase.revision += 1;
  sourceCase.status = "closed";
  sourceCase.mergedIntoCaseId = targetCaseId;
  sourceCase.alertIds = [];
  sourceCase.updatedAt = atIso;
  sourceCase.revision += 1;

  appendAudit(database, {
    caseId: targetCaseId,
    actor,
    action: "并案归入",
    detail:
      `源案件 ${sourceCaseId} 并入：告警 ${movedAlertIds.length} 条，` +
      `节点新建 ${nodeCreated} 个、复用 ${nodesReused} 个，` +
      `关系迁入 ${edgesMigrated} 条、复用 ${edgesReused} 条，` +
      `证据 ${evidenceMoved} 份，草稿结论 ${draftsMoved} 版并入、${snapshotted} 版留快照。`,
  });
  appendAudit(database, {
    caseId: sourceCaseId,
    actor,
    action: "并案迁出",
    detail: `案件整体并入目标案件 ${targetCaseId}，原案件关闭并保留历史留痕。`,
  });

  return {
    sourceCaseId,
    targetCaseId,
    movedAlertIds,
    nodeCreated,
    nodesReused,
    edgesMigrated,
    edgesReused,
    evidenceMoved,
    draftsMoved,
    snapshotted,
  };
}

/* ------------------------------------------------------------------ */
/* 旧数据升级：按现有案件归属补齐来源版本                               */
/* ------------------------------------------------------------------ */

export type VersionedMockDatabase = Omit<MockDatabase, "schemaVersion"> & {
  schemaVersion?: number;
};

export function upgradeDatabase(
  database: VersionedMockDatabase,
): { database: MockDatabase; upgraded: boolean } {
  let upgraded = false;

  if (!database.schemaVersion || database.schemaVersion < MERGE_SCHEMA_VERSION) {
    database.cases.forEach((item) => {
      if (typeof item.revision !== "number") {
        item.revision = 1;
        upgraded = true;
      }
    });
    database.alerts.forEach((item) => {
      if (!item.originCaseId && item.caseId) {
        item.originCaseId = item.caseId;
        upgraded = true;
      }
    });
    database.nodes.forEach((item) => {
      if (!item.originCaseId) {
        item.originCaseId = item.caseId;
        upgraded = true;
      }
    });
    database.edges.forEach((item) => {
      if (!item.originCaseId) {
        item.originCaseId = item.caseId;
        upgraded = true;
      }
    });
    database.evidence.forEach((item) => {
      if (!item.originCaseId) {
        item.originCaseId = item.caseId;
        upgraded = true;
      }
    });
    database.conclusions.forEach((item) => {
      if (!item.originCaseId) {
        item.originCaseId = item.caseId;
        upgraded = true;
      }
    });
    database.schemaVersion = MERGE_SCHEMA_VERSION;
    if (upgraded || !database.schemaVersion) {
      upgraded = true;
    }
  }

  return { database: database as MockDatabase, upgraded };
}
