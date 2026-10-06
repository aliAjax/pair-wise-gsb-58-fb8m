import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCaseMerge,
  createMergePreview,
  detectMergeConflicts,
  MERGE_SCHEMA_VERSION,
  upgradeDatabase,
  type VersionedMockDatabase,
} from "../src/services/caseMerge";
import type {
  ConclusionVersion,
  Evidence,
  InvestigationCase,
  InvestigationEdge,
  InvestigationNode,
  MockDatabase,
} from "../src/services/mockStorage";

const iso = "2026-10-06T10:00:00+08:00";

const makeCase = (
  id: string,
  alertIds: string[],
  extra: Partial<InvestigationCase> = {},
): InvestigationCase => ({
  id,
  title: `案件 ${id}`,
  status: "investigating",
  riskLevel: "high",
  owner: "林澜",
  openedAt: iso,
  updatedAt: iso,
  summary: "测试案件",
  alertIds,
  nextReviewAt: iso,
  revision: 1,
  ...extra,
});

const makeNode = (
  id: string,
  caseId: string,
  label: string,
  kind: InvestigationNode["data"]["kind"] = "account",
): InvestigationNode => ({
  id,
  caseId,
  position: { x: 10, y: 10 },
  data: {
    label,
    kind,
    riskLevel: "high",
    note: "",
    evidenceStrength: "strong",
    source: "测试来源",
    occurredAt: iso,
  },
  originCaseId: caseId,
});

const makeEdge = (
  id: string,
  caseId: string,
  source: string,
  target: string,
  amount?: number,
): InvestigationEdge => ({
  id,
  caseId,
  source,
  target,
  kind: "transfer",
  label: `关系 ${id}`,
  amount,
  occurredAt: iso,
  explanation: "测试关系",
  originCaseId: caseId,
});

const makeEvidence = (id: string, caseId: string): Evidence => ({
  id,
  caseId,
  title: `证据 ${id}`,
  source: "核心系统",
  strength: "strong",
  occurredAt: iso,
  submittedAt: iso,
  submittedBy: "林澜",
  attachment: `${id}.csv`,
  note: "",
  version: 1,
  originCaseId: caseId,
});

const makeConclusion = (
  id: string,
  caseId: string,
  version: number,
  status: ConclusionVersion["status"],
): ConclusionVersion => ({
  id,
  caseId,
  version,
  status,
  disposition: "observe",
  rationale: "这是一段超过十二个字符的结论说明文字。",
  riskControls: ["只收不付"],
  createdBy: "林澜",
  createdAt: iso,
  reviewer: "赵平",
  ...(status === "submitted" ? {} : {}),
  originCaseId: caseId,
});

const makeAlert = (
  id: string,
  caseId: string | undefined,
  amount = 1000,
) => ({
  id,
  title: `告警 ${id}`,
  account: "6222 **** 0001",
  counterparty: "6228 **** 0002",
  channel: "手机银行",
  amount,
  riskLevel: "high" as const,
  score: 90,
  status: "linked" as const,
  detectedAt: iso,
  tags: [],
  deviceId: "DV-1",
  ip: "10.0.0.1",
  caseId,
  originCaseId: caseId,
});

const buildDb = (): MockDatabase => ({
  schemaVersion: MERGE_SCHEMA_VERSION,
  alerts: [makeAlert("A1", "S"), makeAlert("A2", "T", 2000)],
  cases: [makeCase("S", ["A1"]), makeCase("T", ["A2"])],
  nodes: [
    // 源案件：shared 与目标同名复用；unique 新建；dev 同名但类型不同 → 新建
    makeNode("N-S-SHARED", "S", " 6222 **** 8888 "),
    makeNode("N-S-UNIQ", "S", "6217 **** 9999"),
    makeNode("N-S-DEV", "S", "6222 **** 8888", "device"),
    // 目标案件
    makeNode("N-T-SHARED", "T", "6222 **** 8888"),
    makeNode("N-T-UNIQ", "T", "6217 **** 9999"),
  ],
  edges: [
    // shared 端点映射到同一节点且类型金额一致 → 复用
    makeEdge("E-S-DUP", "S", "N-S-SHARED", "N-S-UNIQ", 5000),
    // unique 关系，端点映射后与目标已有不同 → 迁入
    makeEdge("E-S-NEW", "S", "N-S-UNIQ", "N-S-DEV", 8000),
    // 目标案件已有关系：同名节点对之间金额一致 → 与 E-S-DUP 重复
    makeEdge("E-T-EXIST", "T", "N-T-SHARED", "N-T-UNIQ", 5000),
  ],
  evidence: [makeEvidence("EV-S1", "S"), makeEvidence("EV-T1", "T")],
  conclusions: [
    makeConclusion("CV-S-DRAFT", "S", 1, "draft"),
    makeConclusion("CV-S-SUB", "S", 2, "submitted"),
    makeConclusion("CV-S-RET", "S", 3, "returned"),
    makeConclusion("CV-T-APP", "T", 2, "approved"),
  ],
  auditLogs: [],
});

test("预览能识别同名节点复用、重复关系复用与结论处置方式", () => {
  const db = buildDb();
  const preview = createMergePreview(db, "S", "T", iso);

  const nodePlan = new Map(preview.plan.nodes.map((item) => [item.nodeId, item]));
  assert.equal(nodePlan.get("N-S-SHARED")?.action, "reuse");
  assert.equal(nodePlan.get("N-S-SHARED")?.targetNodeId, "N-T-SHARED");
  // 名称归一化（大小写/空白）后同名
  assert.equal(nodePlan.get("N-S-UNIQ")?.action, "reuse");
  assert.equal(nodePlan.get("N-S-UNIQ")?.targetNodeId, "N-T-UNIQ");
  // 同名但类型不同（account vs device）→ 新建
  assert.equal(nodePlan.get("N-S-DEV")?.action, "create");

  const edgePlan = new Map(preview.plan.edges.map((item) => [item.edgeId, item]));
  assert.equal(edgePlan.get("E-S-DUP")?.action, "reuse");
  assert.equal(edgePlan.get("E-S-NEW")?.action, "migrate");

  const conclusionPlan = new Map(
    preview.plan.conclusions.map((item) => [item.conclusionId, item]),
  );
  assert.equal(conclusionPlan.get("CV-S-DRAFT")?.action, "migrate");
  // 目标当前最大版本为 2，草稿续号为 3
  assert.equal(conclusionPlan.get("CV-S-DRAFT")?.targetVersion, 3);
  assert.equal(conclusionPlan.get("CV-S-SUB")?.action, "snapshot");
  assert.equal(conclusionPlan.get("CV-S-RET")?.action, "snapshot");
});

test("确认并案：告警、节点、关系、证据迁移；结论草稿续号、已复核留快照；源案件关闭", () => {
  const db = buildDb();
  const preview = createMergePreview(db, "S", "T", iso);
  const result = applyCaseMerge(db, preview.token, iso);

  assert.deepEqual(result.movedAlertIds.sort(), ["A1"]);
  assert.equal(result.nodesReused, 2);
  assert.equal(result.nodeCreated, 1);
  assert.equal(result.edgesReused, 1);
  assert.equal(result.edgesMigrated, 1);
  assert.equal(result.evidenceMoved, 1);
  assert.equal(result.draftsMoved, 1);
  assert.equal(result.snapshotted, 2);

  // 告警归入目标
  const a1 = db.alerts.find((item) => item.id === "A1");
  assert.equal(a1?.caseId, "T");
  assert.equal(a1?.originCaseId, "S");

  // 目标节点包含复用 + 新建；源案件无残留节点
  const targetNodeLabels = db.nodes
    .filter((item) => item.caseId === "T")
    .map((item) => item.data.label);
  assert.ok(targetNodeLabels.includes("6217 **** 9999"));
  assert.equal(db.nodes.filter((item) => item.caseId === "S").length, 0);
  assert.equal(db.edges.filter((item) => item.caseId === "S").length, 0);
  assert.equal(db.evidence.filter((item) => item.caseId === "S").length, 0);
  assert.equal(db.conclusions.filter((item) => item.caseId === "S").length, 0);

  // 迁入关系端点已改写为目标图谱节点 ID（设备节点为新建 ID）
  const migratedEdge = db.edges.find((item) => item.label === "关系 E-S-NEW");
  assert.ok(migratedEdge);
  assert.equal(migratedEdge?.caseId, "T");
  assert.equal(migratedEdge?.source, "N-T-UNIQ");
  assert.notEqual(migratedEdge?.target, "N-S-DEV");
  const newDeviceNode = db.nodes.find(
    (item) => item.caseId === "T" && item.data.kind === "device",
  );
  assert.ok(newDeviceNode);
  assert.equal(migratedEdge?.target, newDeviceNode?.id);
  assert.equal(newDeviceNode?.originCaseId, "S");

  // 草稿续号为 V3；已提交/退回为快照并保留原始状态
  const migratedDraft = db.conclusions.find(
    (item) =>
      item.caseId === "T" &&
      item.status === "draft" &&
      item.originCaseId === "S",
  );
  assert.ok(migratedDraft);
  assert.equal(migratedDraft?.version, 3);

  const snapshots = db.conclusions.filter((item) => item.status === "snapshot");
  assert.equal(snapshots.length, 2);
  assert.ok(
    snapshots.some(
      (item) =>
        item.snapshotFromCaseId === "S" &&
        item.snapshotFromVersion === 2 &&
        item.snapshotFromStatus === "submitted",
    ),
  );
  assert.ok(
    snapshots.some((item) => item.snapshotFromStatus === "returned"),
  );

  // 案件状态与审计
  const sourceCase = db.cases.find((item) => item.id === "S");
  assert.equal(sourceCase?.status, "closed");
  assert.equal(sourceCase?.mergedIntoCaseId, "T");
  assert.deepEqual(sourceCase?.alertIds, []);
  assert.equal(db.cases.find((item) => item.id === "T")?.revision, 2);
  assert.ok(
    db.auditLogs.some((item) => item.action === "并案归入"),
  );
  assert.ok(
    db.auditLogs.some((item) => item.action === "并案迁出"),
  );
});

test("预览后源案件新增证据：确认列出冲突并停止，不产生半迁移数据", () => {
  const db = buildDb();
  const preview = createMergePreview(db, "S", "T", iso);

  // 模拟另一会话修改源案件：新增证据并提升 revision
  db.evidence.push(makeEvidence("EV-S2-NEW", "S"));
  const sourceCase = db.cases.find((item) => item.id === "S")!;
  sourceCase.revision += 1;
  sourceCase.updatedAt = "2026-10-06T11:00:00+08:00";

  const conflicts = detectMergeConflicts(db, preview.token);
  assert.ok(conflicts.some((item) => item.entity === "case" && item.side === "source"));
  assert.ok(
    conflicts.some(
      (item) =>
        item.entity === "evidence" &&
        item.side === "source" &&
        item.kind === "added" &&
        item.entityId === "EV-S2-NEW",
    ),
  );

  const before = JSON.stringify(db);
  assert.throws(() => applyCaseMerge(db, preview.token, iso));
  // applyCaseMerge 仅在调用方预先检测冲突后使用；这里直接验证：冲突路径不允许提交
  assert.equal(JSON.stringify(db), before, "数据不应被部分迁移");
});

test("预览后目标案件修改关系：冲突被检测到", () => {
  const db = buildDb();
  const preview = createMergePreview(db, "S", "T", iso);

  const targetEdge = db.edges.find((item) => item.id === "E-T-EXIST")!;
  targetEdge.label = "被他人修改的关系";
  db.cases.find((item) => item.id === "T")!.revision += 1;

  const conflicts = detectMergeConflicts(db, preview.token);
  assert.ok(
    conflicts.some(
      (item) =>
        item.side === "target" &&
        item.entity === "edge" &&
        item.kind === "modified",
    ),
  );
});

test("无冲突时 detectMergeConflicts 返回空数组", () => {
  const db = buildDb();
  const preview = createMergePreview(db, "S", "T", iso);
  assert.deepEqual(detectMergeConflicts(db, preview.token), []);
});

test("旧数据升级：按现有案件关系补齐 originCaseId 与 revision", () => {
  const legacy = buildDb() as unknown as VersionedMockDatabase;
  delete legacy.schemaVersion;
  legacy.cases.forEach((item) => {
    delete item.revision;
  });
  legacy.nodes.forEach((item) => {
    delete item.originCaseId;
  });
  legacy.edges.forEach((item) => {
    delete item.originCaseId;
  });
  legacy.evidence.forEach((item) => {
    delete item.originCaseId;
  });
  legacy.conclusions.forEach((item) => {
    delete item.originCaseId;
  });
  legacy.alerts.forEach((item) => {
    delete item.originCaseId;
  });

  const { database, upgraded } = upgradeDatabase(legacy);
  assert.equal(upgraded, true);
  assert.equal(database.schemaVersion, MERGE_SCHEMA_VERSION);
  assert.equal(database.cases.find((item) => item.id === "S")?.revision, 1);
  assert.equal(
    database.nodes.find((item) => item.id === "N-S-SHARED")?.originCaseId,
    "S",
  );
  assert.equal(
    database.edges.find((item) => item.id === "E-T-EXIST")?.originCaseId,
    "T",
  );
  assert.equal(
    database.evidence.find((item) => item.id === "EV-S1")?.originCaseId,
    "S",
  );
  assert.equal(
    database.conclusions.find((item) => item.id === "CV-T-APP")
      ?.originCaseId,
    "T",
  );
  assert.equal(
    database.alerts.find((item) => item.id === "A1")?.originCaseId,
    "S",
  );
});

test("已并案案件不能再次作为并案对象", () => {
  const db = buildDb();
  db.cases.find((item) => item.id === "S")!.mergedIntoCaseId = "T";
  assert.throws(() => createMergePreview(db, "S", "T", iso), /不能再次/);
});
