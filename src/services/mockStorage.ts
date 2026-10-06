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
    return JSON.parse(stored) as MockDatabase;
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
