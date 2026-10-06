// 端到端冒烟：旧库读取升级 → 并案预览 → 并发修改后确认被拒 → 重新预览确认成功
import { pathToFileURL } from "node:url";

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
  },
};

// 1) 写入一份 v1 旧库（无 schemaVersion / revision / originCaseId）
const seedModule = await import(
  pathToFileURL(`${process.cwd()}/src/data/seed.ts`).href
);
const legacyDb = {
  alerts: seedModule.seedAlerts,
  cases: seedModule.seedCases,
  nodes: seedModule.seedNodes,
  edges: seedModule.seedEdges,
  evidence: seedModule.seedEvidence,
  conclusions: seedModule.seedConclusions,
  auditLogs: seedModule.seedAuditLogs,
};
storage.set("bank-fraud-investigation-db-v1", JSON.stringify(legacyDb));

const storageModule = await import(
  pathToFileURL(`${process.cwd()}/src/services/mockStorage.ts`).href
);
const mergeModule = await import(
  pathToFileURL(`${process.cwd()}/src/services/caseMerge.ts`).href
);

// 2) 读取触发升级
const upgraded = storageModule.readDatabase();
if (upgraded.schemaVersion !== 2) {
  throw new Error(`schema 版本应为 2，实际 ${upgraded.schemaVersion}`);
}
if (typeof upgraded.cases[0].revision !== "number") {
  throw new Error("revision 未补齐");
}
if (!upgraded.nodes[0].originCaseId) {
  throw new Error("节点 originCaseId 未补齐");
}
if (
  !upgraded.alerts.find((a) => a.id === "AL-20260929-001").originCaseId
) {
  throw new Error("告警 originCaseId 未补齐");
}
console.log("[1] 旧库升级 OK：schema v2，revision 与 originCaseId 已补齐");

// 3) 预览：016（submitted 结论）并入 017
const preview = mergeModule.createMergePreview(
  upgraded,
  "CASE-2026-016",
  "CASE-2026-017",
  "2026-10-06T10:00:00.000Z",
);
console.log(
  `[2] 预览 OK：告警 ${preview.plan.alerts.length}，节点 ${preview.plan.nodes
    .map((n) => n.action)
    .join("/")}，结论 ${preview.plan.conclusions
    .map((c) => c.action)
    .join("/")}`,
);

// 4) 模拟并发：另一会话给目标案件新增证据
storageModule.writeDatabase(upgraded);
const concurrent = storageModule.readDatabase();
concurrent.evidence.push({
  id: "EV-CONCURRENT",
  caseId: "CASE-2026-017",
  title: "并发新增证据",
  source: "测试",
  strength: "medium",
  occurredAt: "2026-10-06T09:00:00.000Z",
  submittedAt: "2026-10-06T09:01:00.000Z",
  submittedBy: "宋佳",
  attachment: "x.pdf",
  note: "",
  version: 1,
});
concurrent.cases.find((c) => c.id === "CASE-2026-017").revision += 1;
storageModule.writeDatabase(concurrent);

const checkDb = storageModule.readDatabase();
const conflicts = mergeModule.detectMergeConflicts(checkDb, preview.token);
if (conflicts.length === 0) {
  throw new Error("并发修改应当被检测为冲突");
}
if (checkDb.cases.find((c) => c.id === "CASE-2026-016").status !== "pending_review") {
  throw new Error("冲突后源案件不应被改动");
}
console.log(
  `[3] 冲突检测 OK：发现 ${conflicts.length} 处变化（${[
    ...new Set(conflicts.map((c) => `${c.side}:${c.entity}:${c.kind}`)),
  ].join(", ")}），数据未迁移`,
);

// 5) 重新预览并确认
const freshPreview = mergeModule.createMergePreview(
  checkDb,
  "CASE-2026-016",
  "CASE-2026-017",
  "2026-10-06T10:05:00.000Z",
);
const result = mergeModule.applyCaseMerge(
  checkDb,
  freshPreview.token,
  "2026-10-06T10:05:01.000Z",
);
storageModule.writeDatabase(checkDb);
console.log(
  `[4] 并案确认 OK：告警 ${result.movedAlertIds.length}，节点新建 ${result.nodeCreated}/复用 ${result.nodesReused}，关系迁入 ${result.edgesMigrated}/复用 ${result.edgesReused}，草稿 ${result.draftsMoved}，快照 ${result.snapshotted}`,
);

const finalDb = storageModule.readDatabase();
const source = finalDb.cases.find((c) => c.id === "CASE-2026-016");
const target = finalDb.cases.find((c) => c.id === "CASE-2026-017");
if (source.status !== "closed" || source.mergedIntoCaseId !== "CASE-2026-017") {
  throw new Error("源案件未正确关闭/标记并入");
}
if (!target.alertIds.includes("AL-20260927-012")) {
  throw new Error("告警未归入目标案件");
}
const snap = finalDb.conclusions.find((c) => c.status === "snapshot");
if (!snap || snap.snapshotFromStatus !== "submitted" || snap.snapshotFromVersion !== 1) {
  throw new Error("已提交复核的结论未正确转为快照");
}
if (finalDb.nodes.some((n) => n.caseId === "CASE-2026-016")) {
  throw new Error("源案件残留节点");
}
if (!finalDb.auditLogs.some((l) => l.action === "并案归入")) {
  throw new Error("缺少审计日志");
}
console.log("[5] 终态校验 OK：源案件关闭、告警归入、结论留快照、无残留、有审计");
