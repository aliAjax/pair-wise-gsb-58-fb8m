import {
  seedAlerts,
  seedAuditLogs,
  seedCases,
  seedConclusions,
  seedEdges,
  seedEvidence,
  seedNodes,
} from "../data/seed";
import type {
  Alert,
  AuditLog,
  ConclusionVersion,
  Evidence,
  InvestigationCase,
  InvestigationEdge,
  InvestigationNode,
} from "../models/types";

export interface MockDatabase {
  alerts: Alert[];
  cases: InvestigationCase[];
  nodes: InvestigationNode[];
  edges: InvestigationEdge[];
  evidence: Evidence[];
  conclusions: ConclusionVersion[];
  auditLogs: AuditLog[];
}

const STORAGE_KEY = "bank-fraud-investigation-db-v1";

const createSeedDatabase = (): MockDatabase => ({
  alerts: structuredClone(seedAlerts),
  cases: structuredClone(seedCases),
  nodes: structuredClone(seedNodes),
  edges: structuredClone(seedEdges),
  evidence: structuredClone(seedEvidence),
  conclusions: structuredClone(seedConclusions),
  auditLogs: structuredClone(seedAuditLogs),
});

const initialRevisionOf = (
  revision: number | undefined,
  fallback: number,
): number => (typeof revision === "number" && revision > 0 ? revision : fallback);

/**
 * 旧数据没有归属版本，升级时按现有案件关系补齐：
 * - 案件补 revision（旧数据记为 1）；
 * - 节点/关系/证据/结论按 caseId 补 caseRevision；
 * - 告警按 caseId 补归属，并反向修复案件 alertIds。
 * 升级结果写回 localStorage，后续修改才会产生更高版本。
 */
export const upgradeDatabase = (
  database: MockDatabase,
): { database: MockDatabase; upgraded: boolean } => {
  let upgraded = false;
  const next: MockDatabase = structuredClone(database);

  next.cases.forEach((item) => {
    if (typeof item.revision !== "number" || item.revision <= 0) {
      item.revision = 1;
      upgraded = true;
    }
  });

  const revisionOf = (caseId: string): number =>
    next.cases.find((item) => item.id === caseId)?.revision ?? 1;

  next.cases.forEach((item) => {
    const expected = new Set(item.alertIds);
    next.alerts.forEach((alert) => {
      if (alert.caseId === item.id) {
        expected.add(alert.id);
      }
    });
    const repaired = Array.from(expected);
    if (repaired.length !== item.alertIds.length) {
      item.alertIds = repaired;
      upgraded = true;
    }
  });

  const stamp = (
    rows: { caseId: string; caseRevision?: number }[],
  ): void => {
    rows.forEach((row) => {
      if (typeof row.caseRevision !== "number" || row.caseRevision <= 0) {
        row.caseRevision = revisionOf(row.caseId);
        upgraded = true;
      }
    });
  };

  stamp(next.nodes);
  stamp(next.edges);
  stamp(next.evidence);
  stamp(next.conclusions);

  next.alerts.forEach((alert) => {
    if (
      alert.caseId &&
      (typeof alert.caseRevision !== "number" || alert.caseRevision <= 0)
    ) {
      alert.caseRevision = revisionOf(alert.caseId);
      upgraded = true;
    }
  });

  return { database: next, upgraded };
};

/** 案件内容发生修改时调用：推进案件版本并返回新版本号 */
export const bumpCaseRevision = (
  database: MockDatabase,
  caseId: string,
): number => {
  const target = database.cases.find((item) => item.id === caseId);
  if (!target) {
    return 0;
  }
  target.revision = initialRevisionOf(target.revision, 1) + 1;
  return target.revision;
};

export const readDatabase = (): MockDatabase => {
  if (typeof window === "undefined") {
    return createSeedDatabase();
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const seeded = createSeedDatabase();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  try {
    const parsed = JSON.parse(stored) as MockDatabase;
    const { database, upgraded } = upgradeDatabase(parsed);
    if (upgraded) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
    }
    return database;
  } catch {
    const seeded = createSeedDatabase();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
};

export const writeDatabase = (database: MockDatabase): void => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
  }
};

export const resetDatabase = (): MockDatabase => {
  const seeded = createSeedDatabase();
  writeDatabase(seeded);
  return seeded;
};

export const createId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const nowIso = (): string => new Date().toISOString();

export const appendAudit = (
  database: MockDatabase,
  log: Omit<AuditLog, "id" | "at">,
): void => {
  database.auditLogs.unshift({
    id: createId("LOG"),
    at: nowIso(),
    ...log,
  });
};
