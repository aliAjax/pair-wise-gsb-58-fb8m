import type {
  Alert,
  ConclusionVersion,
  Evidence,
  InvestigationCase,
  InvestigationEdge,
  InvestigationNode,
  RiskLevel,
} from "../../models/types";

export interface MergeDatabase {
  alerts: Alert[];
  cases: InvestigationCase[];
  nodes: InvestigationNode[];
  edges: InvestigationEdge[];
  evidence: Evidence[];
  conclusions: ConclusionVersion[];
  auditLogs: unknown[];
}

/* ---------------------------------- 类型 ---------------------------------- */

export type MergeEntityKind =
  | "case"
  | "alert"
  | "node"
  | "edge"
  | "evidence"
  | "conclusion";

export type MergeChangeKind = "reuse" | "move" | "snapshot";

export interface MergeNodePlan {
  kind: "reuse" | "move";
  sourceNodeId: string;
  targetNodeId: string;
  label: string;
  nodeKind: InvestigationNode["data"]["kind"];
  reason: string;
}

export interface MergeEdgePlan {
  kind: "reuse" | "move";
  sourceEdgeId: string;
  targetEdgeId: string;
  label: string;
  edgeKind: InvestigationEdge["kind"];
  reason: string;
}

export interface MergeConclusionPlan {
  kind: MergeChangeKind;
  sourceConclusionId: string;
  sourceVersion: number;
  targetVersion: number;
  status: ConclusionVersion["status"];
  disposition: ConclusionVersion["disposition"];
  rationale: string;
  reason: string;
}

export interface MergePreview {
  sourceCaseId: string;
  targetCaseId: string;
  sourceCaseTitle: string;
  targetCaseTitle: string;
  sourceRevision: number;
  targetRevision: number;
  alerts: Alert[];
  evidence: Evidence[];
  nodePlans: MergeNodePlan[];
  edgePlans: MergeEdgePlan[];
  conclusionPlans: MergeConclusionPlan[];
  counts: {
    alerts: number;
    nodesReuse: number;
    nodesMove: number;
    edgesReuse: number;
    edgesMove: number;
    evidence: number;
    conclusionsMove: number;
    conclusionsSnapshot: number;
  };
  /** 预览时点的实体指纹，确认时用于逐条冲突检测 */
  signatures: {
    sourceRevision: number;
    targetRevision: number;
    sourceCase: string;
    targetCase: string;
    items: Array<{
      side: "source" | "target";
      entity: MergeEntityKind;
      id: string;
      label: string;
      fingerprint: string;
    }>;
  };
}

export interface MergeConflict {
  side: "source" | "target";
  entity: MergeEntityKind;
  id: string;
  label: string;
  change: "added" | "removed" | "modified";
  detail: string;
}

export class MergeConflictError extends Error {
  conflicts: MergeConflict[];

  constructor(conflicts: MergeConflict[]) {
    super("预览后案件数据发生变化，并案已中止");
    this.name = "MergeConflictError";
    this.conflicts = conflicts;
  }
}

/* ---------------------------------- 工具 ---------------------------------- */

/** 稳定序列化：对象键排序后生成指纹，避免键顺序导致误判 */
const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    if (input && typeof input === "object") {
      if (seen.has(input as object)) {
        return null;
      }
      seen.add(input as object);
      return Object.keys(input as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = normalize((input as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return input;
  };
  return JSON.stringify(normalize(value));
};

/** 案件指纹不含 revision / updatedAt / mergedAt 等并案控制字段 */
const caseFingerprint = (item: InvestigationCase): string =>
  stableStringify({
    id: item.id,
    title: item.title,
    status: item.status,
    riskLevel: item.riskLevel,
    owner: item.owner,
    openedAt: item.openedAt,
    summary: item.summary,
    alertIds: item.alertIds,
    nextReviewAt: item.nextReviewAt,
  });

const normalizeNodeLabel = (label: string): string =>
  label.trim().replace(/\s+/g, " ").toLowerCase();

const ownedAlerts = (database: MergeDatabase, caseId: string): Alert[] =>
  database.alerts.filter((item) => item.caseId === caseId);

const riskRank: Record<RiskLevel, number> = { high: 3, medium: 2, low: 1 };

const higherRisk = (a: RiskLevel, b: RiskLevel): RiskLevel =>
  riskRank[a] >= riskRank[b] ? a : b;

/* ---------------------------------- 预览 ---------------------------------- */

export interface BuildMergeInput {
  database: MergeDatabase;
  sourceCaseId: string;
  targetCaseId: string;
}

export const buildMergePreview = ({
  database,
  sourceCaseId,
  targetCaseId,
}: BuildMergeInput): MergePreview => {
  const sourceCase = database.cases.find((item) => item.id === sourceCaseId);
  const targetCase = database.cases.find((item) => item.id === targetCaseId);
  if (!sourceCase) {
    throw new Error("来源案件不存在");
  }
  if (!targetCase) {
    throw new Error("目标案件不存在");
  }
  if (sourceCaseId === targetCaseId) {
    throw new Error("来源案件与目标案件不能相同");
  }
  if (sourceCase.mergedIntoCaseId) {
    throw new Error("来源案件已并入其他案件，不能重复并案");
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
  const sourceConclusions = database.conclusions.filter(
    (item) => item.caseId === sourceCaseId && !item.snapshotFromCaseId,
  );

  // 目标案件已有同名（同类型 + 同名标签）节点就接着用
  const targetNodeIndex = new Map<string, InvestigationNode>();
  targetNodes.forEach((node) => {
    targetNodeIndex.set(
      `${node.data.kind}::${normalizeNodeLabel(node.data.label)}`,
      node,
    );
  });

  const nodeIdMap = new Map<string, string>();
  const nodePlans: MergeNodePlan[] = [];
  sourceNodes.forEach((node) => {
    const key = `${node.data.kind}::${normalizeNodeLabel(node.data.label)}`;
    const existing = targetNodeIndex.get(key);
    if (existing) {
      nodeIdMap.set(node.id, existing.id);
      nodePlans.push({
        kind: "reuse",
        sourceNodeId: node.id,
        targetNodeId: existing.id,
        label: node.data.label,
        nodeKind: node.data.kind,
        reason: `目标案件已有同名${node.data.kind === "account" ? "账户" : "节点"}，并入后共用该节点`,
      });
    } else {
      nodeIdMap.set(node.id, node.id);
      nodePlans.push({
        kind: "move",
        sourceNodeId: node.id,
        targetNodeId: node.id,
        label: node.data.label,
        nodeKind: node.data.kind,
        reason: "目标案件无同名节点，整节点迁入",
      });
    }
  });

  // 重复关系（同类型 + 同端点，端点经同名节点重映射）就接着用
  const targetEdgeIndex = new Set(
    targetEdges.map(
      (edge) => `${edge.kind}::${edge.source}->${edge.target}`,
    ),
  );

  const edgePlans: MergeEdgePlan[] = [];
  sourceEdges.forEach((edge) => {
    const remappedSource = nodeIdMap.get(edge.source) ?? edge.source;
    const remappedTarget = nodeIdMap.get(edge.target) ?? edge.target;
    const key = `${edge.kind}::${remappedSource}->${remappedTarget}`;
    if (targetEdgeIndex.has(key)) {
      const existing = targetEdges.find(
        (item) =>
          `${item.kind}::${item.source}->${item.target}` === key,
      );
      edgePlans.push({
        kind: "reuse",
        sourceEdgeId: edge.id,
        targetEdgeId: existing?.id ?? "",
        label: edge.label,
        edgeKind: edge.kind,
        reason: "目标案件已有同类型、同端点关系，并入后共用该关系",
      });
    } else {
      edgePlans.push({
        kind: "move",
        sourceEdgeId: edge.id,
        targetEdgeId: edge.id,
        label: edge.label,
        edgeKind: edge.kind,
        reason: "目标案件无重复关系，随节点迁入",
      });
    }
  });

  // 已提交复核（含已通过、已退回）的结论只留快照；草稿顺延目标版本号
  const targetActiveConclusions = database.conclusions.filter(
    (item) => item.caseId === targetCaseId && !item.snapshotFromCaseId,
  );
  let nextVersion = targetActiveConclusions.reduce(
    (max, item) => Math.max(max, item.version),
    0,
  );

  const conclusionPlans: MergeConclusionPlan[] = sourceConclusions
    .slice()
    .sort((a, b) => a.version - b.version)
    .map((item) => {
      const isLocked = item.status !== "draft";
      if (isLocked) {
        return {
          kind: "snapshot" as const,
          sourceConclusionId: item.id,
          sourceVersion: item.version,
          targetVersion: item.version,
          status: item.status,
          disposition: item.disposition,
          rationale: item.rationale,
          reason:
            item.status === "submitted"
              ? "已提交复核，并入后仅保留只读快照，不进入目标案件当前版本链"
              : item.status === "approved"
                ? "已复核通过，并入后仅保留只读快照"
                : "已被退回补证，并入后仅保留历史快照",
        };
      }
      nextVersion += 1;
      return {
        kind: "move" as const,
        sourceConclusionId: item.id,
        sourceVersion: item.version,
        targetVersion: nextVersion,
        status: item.status,
        disposition: item.disposition,
        rationale: item.rationale,
        reason: `草稿可继续编辑，顺延为目标案件 V${nextVersion}`,
      };
    });

  const alerts = ownedAlerts(database, sourceCaseId);
  const evidence = sourceEvidence;

  // 实体指纹：预览时点双方案件本体与各自全部归属实体
  const items: MergePreview["signatures"]["items"] = [];
  const pushItems = (
    side: "source" | "target",
    entity: MergeEntityKind,
    rows: Array<{ id: string; label: string; fingerprint: string }>,
  ) => {
    rows.forEach((row) => items.push({ side, entity, ...row }));
  };

  pushItems("source", "case", [
    {
      id: sourceCase.id,
      label: sourceCase.title,
      fingerprint: caseFingerprint(sourceCase),
    },
  ]);
  pushItems("target", "case", [
    {
      id: targetCase.id,
      label: targetCase.title,
      fingerprint: caseFingerprint(targetCase),
    },
  ]);
  pushItems(
    "source",
    "alert",
    ownedAlerts(database, sourceCaseId).map((item) => ({
      id: item.id,
      label: item.title,
      fingerprint: stableStringify(item),
    })),
  );
  pushItems(
    "target",
    "alert",
    ownedAlerts(database, targetCaseId).map((item) => ({
      id: item.id,
      label: item.title,
      fingerprint: stableStringify(item),
    })),
  );
  pushItems(
    "source",
    "node",
    sourceNodes.map((item) => ({
      id: item.id,
      label: item.data.label,
      fingerprint: stableStringify(item),
    })),
  );
  pushItems(
    "target",
    "node",
    targetNodes.map((item) => ({
      id: item.id,
      label: item.data.label,
      fingerprint: stableStringify(item),
    })),
  );
  pushItems(
    "source",
    "edge",
    sourceEdges.map((item) => ({
      id: item.id,
      label: item.label,
      fingerprint: stableStringify(item),
    })),
  );
  pushItems(
    "target",
    "edge",
    targetEdges.map((item) => ({
      id: item.id,
      label: item.label,
      fingerprint: stableStringify(item),
    })),
  );
  pushItems(
    "source",
    "evidence",
    sourceEvidence.map((item) => ({
      id: item.id,
      label: item.title,
      fingerprint: stableStringify(item),
    })),
  );
  pushItems(
    "target",
    "evidence",
    database.evidence
      .filter((item) => item.caseId === targetCaseId)
      .map((item) => ({
        id: item.id,
        label: item.title,
        fingerprint: stableStringify(item),
      })),
  );
  pushItems(
    "source",
    "conclusion",
    sourceConclusions.map((item) => ({
      id: item.id,
      label: `V${item.version} 结论`,
      fingerprint: stableStringify(item),
    })),
  );
  pushItems(
    "target",
    "conclusion",
    targetActiveConclusions.map((item) => ({
      id: item.id,
      label: `V${item.version} 结论`,
      fingerprint: stableStringify(item),
    })),
  );

  return {
    sourceCaseId,
    targetCaseId,
    sourceCaseTitle: sourceCase.title,
    targetCaseTitle: targetCase.title,
    sourceRevision: sourceCase.revision,
    targetRevision: targetCase.revision,
    alerts,
    evidence,
    nodePlans,
    edgePlans,
    conclusionPlans,
    counts: {
      alerts: alerts.length,
      nodesReuse: nodePlans.filter((item) => item.kind === "reuse").length,
      nodesMove: nodePlans.filter((item) => item.kind === "move").length,
      edgesReuse: edgePlans.filter((item) => item.kind === "reuse").length,
      edgesMove: edgePlans.filter((item) => item.kind === "move").length,
      evidence: evidence.length,
      conclusionsMove: conclusionPlans.filter(
        (item) => item.kind === "move",
      ).length,
      conclusionsSnapshot: conclusionPlans.filter(
        (item) => item.kind === "snapshot",
      ).length,
    },
    signatures: {
      sourceRevision: sourceCase.revision,
      targetRevision: targetCase.revision,
      sourceCase: caseFingerprint(sourceCase),
      targetCase: caseFingerprint(targetCase),
      items,
    },
  };
};

/* -------------------------------- 冲突检测 -------------------------------- */

/**
 * 预览后有人同时修改过任一案件时，逐条比对实体，列出冲突。
 * 只返回冲突；无冲突返回空数组。
 */
export const detectMergeConflicts = (
  database: MergeDatabase,
  preview: MergePreview,
): MergeConflict[] => {
  const conflicts: MergeConflict[] = [];
  const { sourceCaseId, targetCaseId } = preview;

  const sourceCase = database.cases.find((item) => item.id === sourceCaseId);
  const targetCase = database.cases.find((item) => item.id === targetCaseId);
  if (!sourceCase) {
    conflicts.push({
      side: "source",
      entity: "case",
      id: sourceCaseId,
      label: preview.sourceCaseTitle,
      change: "removed",
      detail: "来源案件已被删除或不存在",
    });
    return conflicts;
  }
  if (!targetCase) {
    conflicts.push({
      side: "target",
      entity: "case",
      id: targetCaseId,
      label: preview.targetCaseTitle,
      change: "removed",
      detail: "目标案件已被删除或不存在",
    });
    return conflicts;
  }
  if (sourceCase.mergedIntoCaseId) {
    conflicts.push({
      side: "source",
      entity: "case",
      id: sourceCaseId,
      label: sourceCase.title,
      change: "modified",
      detail: "来源案件已被并入其他案件",
    });
  }

  // 先比对案件本体（revision 只是快速短路，指纹给出具体修改）
  if (caseFingerprint(sourceCase) !== preview.signatures.sourceCase) {
    conflicts.push({
      side: "source",
      entity: "case",
      id: sourceCase.id,
      label: sourceCase.title,
      change: "modified",
      detail: `案件信息已变更（预览时 R${preview.sourceRevision}，当前 R${sourceCase.revision}）`,
    });
  }
  if (caseFingerprint(targetCase) !== preview.signatures.targetCase) {
    conflicts.push({
      side: "target",
      entity: "case",
      id: targetCase.id,
      label: targetCase.title,
      change: "modified",
      detail: `案件信息已变更（预览时 R${preview.targetRevision}，当前 R${targetCase.revision}）`,
    });
  }

  const ownedBy = (caseId: string) => ({
    alert: database.alerts.filter((item) => item.caseId === caseId),
    node: database.nodes.filter((item) => item.caseId === caseId),
    edge: database.edges.filter((item) => item.caseId === caseId),
    evidence: database.evidence.filter((item) => item.caseId === caseId),
    conclusion: database.conclusions.filter(
      (item) => item.caseId === caseId && !item.snapshotFromCaseId,
    ),
  });

  type Owned = ReturnType<typeof ownedBy>;
  const currentFingerprint = (
    side: "source" | "target",
    entity: MergeEntityKind,
    id: string,
  ): string | undefined => {
    const owned: Owned =
      side === "source" ? ownedBy(sourceCaseId) : ownedBy(targetCaseId);
    if (entity === "case") {
      return undefined;
    }
    const found = owned[entity].find(
      (row: { id: string }) => row.id === id,
    );
    return found ? stableStringify(found) : undefined;
  };

  // 预览存在的实体：被删除 / 被修改
  preview.signatures.items
    .filter((item) => item.entity !== "case")
    .forEach((item) => {
      const fingerprint = currentFingerprint(
        item.side,
        item.entity,
        item.id,
      );
      if (fingerprint === undefined) {
        conflicts.push({
          side: item.side,
          entity: item.entity,
          id: item.id,
          label: item.label,
          change: "removed",
          detail: "预览后该条数据已被删除或移出案件",
        });
        return;
      }
      if (fingerprint !== item.fingerprint) {
        conflicts.push({
          side: item.side,
          entity: item.entity,
          id: item.id,
          label: item.label,
          change: "modified",
          detail: "预览后该条数据内容被修改",
        });
      }
    });

  // 预览后新增到任一案件的实体
  const previewKeys = new Set(
    preview.signatures.items
      .filter((item) => item.entity !== "case")
      .map((item) => `${item.side}::${item.entity}::${item.id}`),
  );
  const labelOfAdded = (
    entity: Exclude<MergeEntityKind, "case">,
    row: Owned[keyof Owned][number],
  ): string => {
    switch (entity) {
      case "alert":
        return (row as Alert).title;
      case "node":
        return (row as InvestigationNode).data.label;
      case "edge":
        return (row as InvestigationEdge).label;
      case "evidence":
        return (row as Evidence).title;
      case "conclusion":
        return `V${(row as ConclusionVersion).version} 结论`;
    }
  };

  (["source", "target"] as const).forEach((side) => {
    const caseId = side === "source" ? sourceCaseId : targetCaseId;
    const owned = ownedBy(caseId);
    (
      ["alert", "node", "edge", "evidence", "conclusion"] as const
    ).forEach((entity) => {
      owned[entity].forEach((row) => {
        const key = `${side}::${entity}::${row.id}`;
        if (!previewKeys.has(key)) {
          conflicts.push({
            side,
            entity,
            id: row.id,
            label: labelOfAdded(entity, row),
            change: "added",
            detail: "预览后有新数据加入该案件",
          });
        }
      });
    });
  });

  return conflicts;
};

/* -------------------------------- 执行并案 -------------------------------- */

export interface ApplyMergeResult {
  targetCase: InvestigationCase;
  mergedAlertIds: string[];
}

/**
 * 在传入的 database 上直接应用并案（不写存储，由调用方一次性原子写入）。
 * 调用前必须先跑 detectMergeConflicts；有冲突应抛 MergeConflictError 中止，
 * 从而保证不会留下半迁移数据。
 */
export const applyMerge = (
  database: MergeDatabase,
  preview: MergePreview,
  now: string,
): ApplyMergeResult => {
  const sourceCase = database.cases.find(
    (item) => item.id === preview.sourceCaseId,
  );
  const targetCase = database.cases.find(
    (item) => item.id === preview.targetCaseId,
  );
  if (!sourceCase || !targetCase) {
    throw new Error("案件不存在，无法并案");
  }

  const targetRevision =
    (typeof targetCase.revision === "number" ? targetCase.revision : 1) + 1;
  targetCase.revision = targetRevision;
  targetCase.updatedAt = now;

  // 风险等级就高不就低
  targetCase.riskLevel = higherRisk(
    targetCase.riskLevel,
    sourceCase.riskLevel,
  );

  // 同名节点映射（以当前库重新计算，与预览保持同一规则）
  const targetNodes = database.nodes.filter(
    (item) => item.caseId === targetCase.id,
  );
  const targetNodeIndex = new Map<string, InvestigationNode>();
  targetNodes.forEach((node) => {
    targetNodeIndex.set(
      `${node.data.kind}::${normalizeNodeLabel(node.data.label)}`,
      node,
    );
  });

  const nodeIdMap = new Map<string, string>();
  const reusedNodeIds = new Set<string>();
  database.nodes.forEach((node) => {
    if (node.caseId !== sourceCase.id) {
      return;
    }
    const key = `${node.data.kind}::${normalizeNodeLabel(node.data.label)}`;
    const existing = targetNodeIndex.get(key);
    if (existing) {
      nodeIdMap.set(node.id, existing.id);
      reusedNodeIds.add(node.id);
    } else {
      nodeIdMap.set(node.id, node.id);
    }
  });

  // 节点：复用的删除源节点；迁入的改挂目标案件、布局错开避免重叠
  database.nodes = database.nodes.filter(
    (node) => !reusedNodeIds.has(node.id),
  );
  database.nodes.forEach((node) => {
    if (node.caseId === sourceCase.id) {
      node.caseId = targetCase.id;
      node.position = { x: node.position.x + 90, y: node.position.y + 90 };
      node.caseRevision = targetRevision;
    }
  });

  // 关系：端点按同名节点重映射；与目标重复的删除源关系，其余迁入
  const targetEdgesAfter = database.edges.filter(
    (item) => item.caseId === targetCase.id,
  );
  const duplicateEdgeIds = new Set<string>();
  database.edges.forEach((edge) => {
    if (edge.caseId !== sourceCase.id) {
      return;
    }
    const remappedSource = nodeIdMap.get(edge.source) ?? edge.source;
    const remappedTarget = nodeIdMap.get(edge.target) ?? edge.target;
    const isDuplicate = targetEdgesAfter.some(
      (item) =>
        item.kind === edge.kind &&
        item.source === remappedSource &&
        item.target === remappedTarget,
    );
    if (isDuplicate) {
      duplicateEdgeIds.add(edge.id);
    }
  });
  database.edges = database.edges.filter(
    (edge) => !duplicateEdgeIds.has(edge.id),
  );
  database.edges.forEach((edge) => {
    if (edge.caseId === sourceCase.id) {
      edge.caseId = targetCase.id;
      edge.source = nodeIdMap.get(edge.source) ?? edge.source;
      edge.target = nodeIdMap.get(edge.target) ?? edge.target;
      edge.caseRevision = targetRevision;
    }
  });

  // 证据：全部迁入
  database.evidence.forEach((item) => {
    if (item.caseId === sourceCase.id) {
      item.caseId = targetCase.id;
      item.caseRevision = targetRevision;
    }
  });

  // 结论：已提交/通过/退回仅留快照；草稿按预览顺延版本号
  const planById = new Map(
    preview.conclusionPlans.map((item) => [
      item.sourceConclusionId,
      item,
    ]),
  );
  database.conclusions.forEach((item) => {
    if (item.caseId !== sourceCase.id || item.snapshotFromCaseId) {
      return;
    }
    const plan = planById.get(item.id);
    if (!plan) {
      return;
    }
    item.caseId = targetCase.id;
    item.caseRevision = targetRevision;
    if (plan.kind === "snapshot") {
      item.snapshotFromCaseId = sourceCase.id;
      item.snapshotFromCaseTitle = sourceCase.title;
      item.snapshotAt = now;
      // 快照保留原版本号，不占用目标案件版本链
    } else {
      item.version = plan.targetVersion;
    }
  });

  // 告警：全部改挂目标案件（保留原处置状态）
  const mergedAlertIds: string[] = [];
  database.alerts.forEach((alert) => {
    if (alert.caseId === sourceCase.id) {
      alert.caseId = targetCase.id;
      alert.caseRevision = targetRevision;
      mergedAlertIds.push(alert.id);
    }
  });

  targetCase.alertIds = Array.from(
    new Set([...targetCase.alertIds, ...mergedAlertIds]),
  );

  // 来源案件保留为只读壳，审计与快照不断链
  sourceCase.status = "closed";
  sourceCase.alertIds = [];
  sourceCase.mergedIntoCaseId = targetCase.id;
  sourceCase.mergedAt = now;
  sourceCase.updatedAt = now;
  sourceCase.revision =
    (typeof sourceCase.revision === "number" ? sourceCase.revision : 1) + 1;
  sourceCase.summary = `【已并入 ${targetCase.id}】${sourceCase.summary}`;

  return { targetCase, mergedAlertIds };
};
