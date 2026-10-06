import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  Alert,
  AlertFilters,
  AuditLog,
  CaseDisposition,
  CaseStatus,
  ConclusionVersion,
  DashboardSummary,
  Evidence,
  InvestigationCase,
  InvestigationNode,
  RiskLevel,
} from "../models/types";
import {
  applyMerge,
  buildMergePreview,
  detectMergeConflicts,
  MergeConflictError,
  type MergeConflict,
  type MergePreview,
} from "../features/caseMerge/mergeCases";
import {
  appendAudit,
  bumpCaseRevision,
  createId,
  nowIso,
  readDatabase,
  resetDatabase,
  writeDatabase,
} from "./mockStorage";

const wait = (milliseconds = 260) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export interface AddNodeInput {
  caseId: string;
  node: InvestigationNode;
  relation?: {
    sourceId: string;
    kind: "transfer" | "shared_device" | "shared_ip" | "payee";
    label: string;
    explanation: string;
    amount?: number;
  };
}

export const bankApi = createApi({
  reducerPath: "bankApi",
  baseQuery: fakeBaseQuery(),
  tagTypes: ["Alerts", "Cases", "Case", "Audit", "Dashboard"],
  endpoints: (builder) => ({
    getDashboard: builder.query<DashboardSummary, void>({
      queryFn: async () => {
        await wait();
        const database = readDatabase();
        const activeCases = database.cases.filter(
          (item) => item.status !== "closed",
        );
        const caseStatusCounts: DashboardSummary["caseStatusCounts"] = {
          investigating: 0,
          pending_review: 0,
          supplement: 0,
          closed: 0,
        };
        const riskCounts: DashboardSummary["riskCounts"] = {
          high: 0,
          medium: 0,
          low: 0,
        };

        database.cases.forEach((item) => {
          caseStatusCounts[item.status] += 1;
          riskCounts[item.riskLevel] += 1;
        });

        return {
          data: {
            newAlerts: database.alerts.filter((item) => item.status === "new")
              .length,
            highRiskAlerts: database.alerts.filter(
              (item) => item.riskLevel === "high",
            ).length,
            activeCases: activeCases.length,
            pendingReview: database.cases.filter((item) =>
              ["pending_review", "supplement"].includes(item.status),
            ).length,
            totalExposure: database.alerts.reduce(
              (sum, item) => sum + item.amount,
              0,
            ),
            caseStatusCounts,
            riskCounts,
          },
        };
      },
      providesTags: ["Dashboard"],
    }),
    getAlerts: builder.query<Alert[], AlertFilters>({
      queryFn: async (filters) => {
        await wait();
        const database = readDatabase();
        const keyword = filters.keyword.trim().toLowerCase();
        const items = database.alerts.filter((item) => {
          const matchesKeyword =
            !keyword ||
            [
              item.id,
              item.title,
              item.account,
              item.counterparty,
              item.deviceId,
              item.ip,
              ...item.tags,
            ]
              .join(" ")
              .toLowerCase()
              .includes(keyword);
          const matchesRisk =
            filters.riskLevel === "all" ||
            item.riskLevel === filters.riskLevel;
          const matchesStatus =
            filters.status === "all" || item.status === filters.status;
          const matchesChannel =
            !filters.channel || item.channel === filters.channel;
          return (
            matchesKeyword && matchesRisk && matchesStatus && matchesChannel
          );
        });
        return { data: items };
      },
      providesTags: ["Alerts"],
    }),
    getCases: builder.query<InvestigationCase[], void>({
      queryFn: async () => {
        await wait();
        return { data: readDatabase().cases };
      },
      providesTags: ["Cases"],
    }),
    getCaseWorkspace: builder.query<
      {
        case: InvestigationCase;
        nodes: InvestigationNode[];
        edges: ReturnType<typeof readDatabase>["edges"];
        evidence: Evidence[];
        conclusions: ConclusionVersion[];
      },
      string
    >({
      queryFn: async (caseId) => {
        await wait();
        const database = readDatabase();
        const investigationCase = database.cases.find(
          (item) => item.id === caseId,
        );
        if (!investigationCase) {
          return { error: { status: "CUSTOM_ERROR", error: "案件不存在" } };
        }
        return {
          data: {
            case: investigationCase,
            nodes: database.nodes.filter((item) => item.caseId === caseId),
            edges: database.edges.filter((item) => item.caseId === caseId),
            evidence: database.evidence.filter(
              (item) => item.caseId === caseId,
            ),
            conclusions: database.conclusions
              .filter((item) => item.caseId === caseId)
              .sort((a, b) => {
                // 当前版本链在前（版本倒序），并案保留的只读快照在后
                if (Boolean(a.snapshotFromCaseId) !== Boolean(b.snapshotFromCaseId)) {
                  return a.snapshotFromCaseId ? 1 : -1;
                }
                if (a.snapshotFromCaseId && b.snapshotFromCaseId) {
                  return (b.snapshotAt ?? "").localeCompare(a.snapshotAt ?? "");
                }
                return b.version - a.version;
              }),
          },
        };
      },
      providesTags: (_result, _error, caseId) => [
        { type: "Case", id: caseId },
        "Dashboard",
      ],
    }),
    getAuditLogs: builder.query<AuditLog[], void>({
      queryFn: async () => {
        await wait();
        return { data: readDatabase().auditLogs };
      },
      providesTags: ["Audit"],
    }),
    linkAlertsToCase: builder.mutation<
      Alert[],
      { alertIds: string[]; caseId: string }
    >({
      queryFn: async ({ alertIds, caseId }) => {
        await wait();
        const database = readDatabase();
        const targetCase = database.cases.find((item) => item.id === caseId);
        if (!targetCase) {
          return { error: { status: "CUSTOM_ERROR", error: "案件不存在" } };
        }
        const updated = database.alerts.map((item) =>
          alertIds.includes(item.id)
            ? { ...item, caseId, status: "linked" as const }
            : item,
        );
        const selected = updated.filter((item) => alertIds.includes(item.id));
        targetCase.alertIds = Array.from(
          new Set([...targetCase.alertIds, ...alertIds]),
        );
        const revision = bumpCaseRevision(database, caseId);
        selected.forEach((item) => {
          item.caseRevision = revision;
        });
        targetCase.updatedAt = nowIso();
        database.alerts = updated;
        appendAudit(database, {
          caseId,
          actor: "林澜",
          action: "批量关联告警",
          detail: `关联告警 ${alertIds.join("、")}。`,
        });
        writeDatabase(database);
        return { data: selected };
      },
      invalidatesTags: ["Alerts", "Cases", "Audit", "Dashboard"],
    }),
    updateAlertStatus: builder.mutation<
      Alert,
      { alertId: string; status: Alert["status"] }
    >({
      queryFn: async ({ alertId, status }) => {
        await wait();
        const database = readDatabase();
        const alert = database.alerts.find((item) => item.id === alertId);
        if (!alert) {
          return { error: { status: "CUSTOM_ERROR", error: "告警不存在" } };
        }
        alert.status = status;
        if (alert.caseId) {
          alert.caseRevision = bumpCaseRevision(database, alert.caseId);
        }
        appendAudit(database, {
          caseId: alert.caseId,
          actor: "林澜",
          action: "更新告警状态",
          detail: `${alert.id} 状态更新为 ${status}。`,
        });
        writeDatabase(database);
        return { data: alert };
      },
      invalidatesTags: ["Alerts", "Case", "Audit", "Dashboard"],
    }),
    addGraphNode: builder.mutation<
      InvestigationNode,
      AddNodeInput
    >({
      queryFn: async ({ caseId, node, relation }) => {
        await wait();
        const database = readDatabase();
        if (!database.cases.some((item) => item.id === caseId)) {
          return { error: { status: "CUSTOM_ERROR", error: "案件不存在" } };
        }
        const revision = bumpCaseRevision(database, caseId);
        database.nodes.push({ ...node, caseRevision: revision });
        if (relation) {
          database.edges.push({
            id: createId("E"),
            caseId,
            source: relation.sourceId,
            target: node.id,
            kind: relation.kind,
            label: relation.label,
            amount: relation.amount,
            occurredAt: node.data.occurredAt,
            explanation: relation.explanation,
            caseRevision: revision,
          });
        }
        const targetCase = database.cases.find((item) => item.id === caseId);
        if (targetCase) {
          targetCase.updatedAt = nowIso();
        }
        appendAudit(database, {
          caseId,
          actor: "林澜",
          action: "加入图谱节点",
          detail: `${node.data.label} 已加入，证据强度 ${node.data.evidenceStrength}。`,
        });
        writeDatabase(database);
        return { data: node };
      },
      invalidatesTags: (_result, _error, input) => [
        { type: "Case", id: input.caseId },
        "Audit",
        "Dashboard",
      ],
    }),
    updateGraphNode: builder.mutation<
      InvestigationNode,
      { caseId: string; node: InvestigationNode }
    >({
      queryFn: async ({ caseId, node }) => {
        await wait(80);
        const database = readDatabase();
        const index = database.nodes.findIndex((item) => item.id === node.id);
        if (index < 0) {
          return { error: { status: "CUSTOM_ERROR", error: "节点不存在" } };
        }
        database.nodes[index] = {
          ...database.nodes[index],
          ...node,
          caseRevision: bumpCaseRevision(database, caseId),
        };
        writeDatabase(database);
        return { data: database.nodes[index] };
      },
      invalidatesTags: (_result, _error, input) => [
        { type: "Case", id: input.caseId },
      ],
    }),
    addEvidence: builder.mutation<
      Evidence,
      Omit<Evidence, "id" | "submittedAt" | "submittedBy" | "version">
    >({
      queryFn: async (input) => {
        await wait();
        const database = readDatabase();
        const revision = bumpCaseRevision(database, input.caseId);
        const evidence: Evidence = {
          ...input,
          id: createId("EV"),
          submittedAt: nowIso(),
          submittedBy: "林澜",
          version: 1,
          caseRevision: revision,
        };
        database.evidence.unshift(evidence);
        const targetCase = database.cases.find(
          (item) => item.id === input.caseId,
        );
        if (targetCase) {
          targetCase.updatedAt = nowIso();
        }
        appendAudit(database, {
          caseId: input.caseId,
          actor: "林澜",
          action: "新增证据",
          detail: `${input.title} 已登记，来源为 ${input.source}。`,
        });
        writeDatabase(database);
        return { data: evidence };
      },
      invalidatesTags: (_result, _error, input) => [
        { type: "Case", id: input.caseId },
        "Audit",
        "Dashboard",
      ],
    }),
    saveConclusion: builder.mutation<
      ConclusionVersion,
      {
        caseId: string;
        disposition: CaseDisposition;
        rationale: string;
        riskControls: string[];
        submit?: boolean;
      }
    >({
      queryFn: async (input) => {
        await wait();
        const database = readDatabase();
        const existing = database.conclusions.filter(
          (item) => item.caseId === input.caseId && !item.snapshotFromCaseId,
        );
        const revision = bumpCaseRevision(database, input.caseId);
        const conclusion: ConclusionVersion = {
          id: createId("CV"),
          caseId: input.caseId,
          version:
            existing.reduce((max, item) => Math.max(max, item.version), 0) + 1,
          status: input.submit ? "submitted" : "draft",
          disposition: input.disposition,
          rationale: input.rationale,
          riskControls: input.riskControls,
          createdBy: "林澜",
          createdAt: nowIso(),
          reviewer: "赵平",
          caseRevision: revision,
        };
        database.conclusions.unshift(conclusion);
        const targetCase = database.cases.find(
          (item) => item.id === input.caseId,
        );
        if (targetCase) {
          targetCase.status = input.submit ? "pending_review" : "investigating";
          targetCase.updatedAt = nowIso();
        }
        appendAudit(database, {
          caseId: input.caseId,
          actor: "林澜",
          action: "保存结论版本",
          detail: `${conclusion.id} V${conclusion.version} 已${input.submit ? "提交复核" : "保存为草稿"}。`,
        });
        writeDatabase(database);
        return { data: conclusion };
      },
      invalidatesTags: (_result, _error, input) => [
        { type: "Case", id: input.caseId },
        "Audit",
        "Cases",
        "Dashboard",
      ],
    }),
    transitionCase: builder.mutation<
      InvestigationCase,
      { caseId: string; status: CaseStatus; reason?: string }
    >({
      queryFn: async ({ caseId, status, reason }) => {
        await wait();
        const database = readDatabase();
        const targetCase = database.cases.find((item) => item.id === caseId);
        if (!targetCase) {
          return { error: { status: "CUSTOM_ERROR", error: "案件不存在" } };
        }
        if (status === "pending_review") {
          const hasSubmitted = database.conclusions.some(
            (item) =>
              item.caseId === caseId &&
              item.status === "submitted" &&
              !item.snapshotFromCaseId,
          );
          if (!hasSubmitted) {
            return {
              error: {
                status: "CUSTOM_ERROR",
                error: "请先提交一份结论版本，再进入复核。",
              },
            };
          }
        }
        bumpCaseRevision(database, caseId);
        targetCase.status = status;
        targetCase.updatedAt = nowIso();
        appendAudit(database, {
          caseId,
          actor: "林澜",
          action: "案件状态流转",
          detail: `状态更新为 ${status}${reason ? `，原因：${reason}` : ""}。`,
        });
        writeDatabase(database);
        return { data: targetCase };
      },
      invalidatesTags: (_result, _error, input) => [
        { type: "Case", id: input.caseId },
        "Cases",
        "Audit",
        "Dashboard",
      ],
    }),
    reviewConclusion: builder.mutation<
      ConclusionVersion,
      {
        caseId: string;
        conclusionId: string;
        decision: "approve" | "return";
        reviewerNote: string;
      }
    >({
      queryFn: async ({ caseId, conclusionId, decision, reviewerNote }) => {
        await wait();
        const database = readDatabase();
        const conclusion = database.conclusions.find(
          (item) => item.id === conclusionId,
        );
        if (!conclusion) {
          return { error: { status: "CUSTOM_ERROR", error: "结论不存在" } };
        }
        if (conclusion.snapshotFromCaseId) {
          return {
            error: {
              status: "CUSTOM_ERROR",
              error: "并案保留的结论快照只读，不能再次复核。",
            },
          };
        }
        if (
          conclusion.status !== "submitted" &&
          conclusion.status !== "draft"
        ) {
          return {
            error: {
              status: "CUSTOM_ERROR",
              error: "当前版本不能再次复核。",
            },
          };
        }
        conclusion.status = decision === "approve" ? "approved" : "returned";
        conclusion.reviewerNote = reviewerNote;
        const targetCase = database.cases.find((item) => item.id === caseId);
        if (targetCase) {
          targetCase.status =
            decision === "approve" ? "closed" : "supplement";
          targetCase.updatedAt = nowIso();
          bumpCaseRevision(database, caseId);
        }
        appendAudit(database, {
          caseId,
          actor: "赵平",
          action: decision === "approve" ? "复核通过" : "退回补证",
          detail: `${conclusion.id} 已${decision === "approve" ? "通过" : "退回"}。${reviewerNote}`,
        });
        writeDatabase(database);
        return { data: conclusion };
      },
      invalidatesTags: (_result, _error, input) => [
        { type: "Case", id: input.caseId },
        "Cases",
        "Audit",
        "Dashboard",
      ],
    }),
    getMergePreview: builder.query<
      MergePreview,
      { sourceCaseId: string; targetCaseId: string }
    >({
      queryFn: async ({ sourceCaseId, targetCaseId }) => {
        await wait();
        const database = readDatabase();
        try {
          const preview = buildMergePreview({
            database,
            sourceCaseId,
            targetCaseId,
          });
          return { data: preview };
        } catch (previewError) {
          return {
            error: {
              status: "CUSTOM_ERROR",
              error:
                previewError instanceof Error
                  ? previewError.message
                  : "无法生成并案预览",
            },
          };
        }
      },
      providesTags: (_result, _error, arg) => [
        { type: "Case", id: arg.sourceCaseId },
        { type: "Case", id: arg.targetCaseId },
      ],
    }),
    confirmCaseMerge: builder.mutation<
      {
        targetCase: InvestigationCase;
        mergedAlertIds: string[];
        conflicts: MergeConflict[];
      },
      { preview: MergePreview }
    >({
      queryFn: async ({ preview }) => {
        await wait();
        const database = readDatabase();

        // 确认时重新检测：预览后任一案件被改动就列出冲突并停住
        const conflicts = detectMergeConflicts(database, preview);
        if (conflicts.length > 0) {
          return {
            error: {
              status: "MERGE_CONFLICT",
              error: new MergeConflictError(conflicts).message,
              conflicts,
            },
          };
        }

        const mergedAt = nowIso();
        const { targetCase, mergedAlertIds } = applyMerge(
          database,
          preview,
          mergedAt,
        );

        appendAudit(database, {
          caseId: targetCase.id,
          actor: "林澜",
          action: "并案归入",
          detail: `${preview.sourceCaseId}（${preview.sourceCaseTitle}）已并入本案件：告警 ${mergedAlertIds.length} 条，节点复用 ${preview.counts.nodesReuse} 个、迁入 ${preview.counts.nodesMove} 个，关系复用 ${preview.counts.edgesReuse} 条、迁入 ${preview.counts.edgesMove} 条，结论快照 ${preview.counts.conclusionsSnapshot} 份。`,
        });
        appendAudit(database, {
          caseId: preview.sourceCaseId,
          actor: "林澜",
          action: "案件并出关闭",
          detail: `本案件已整体并入 ${targetCase.id}（${targetCase.title}），原案件保留只读快照与审计记录。`,
        });

        // 单次写入，保证节点、关系、证据、结论和告警原子迁移
        writeDatabase(database);
        return { data: { targetCase, mergedAlertIds, conflicts: [] } };
      },
      invalidatesTags: (_result, _error, arg) => [
        "Alerts",
        "Cases",
        "Audit",
        "Dashboard",
        { type: "Case", id: arg.preview.sourceCaseId },
        { type: "Case", id: arg.preview.targetCaseId },
      ],
    }),
    resetMockData: builder.mutation<{ ok: boolean }, void>({
      queryFn: async () => {
        await wait(180);
        resetDatabase();
        return { data: { ok: true } };
      },
      invalidatesTags: ["Alerts", "Cases", "Case", "Audit", "Dashboard"],
    }),
  }),
});

export const {
  useAddEvidenceMutation,
  useAddGraphNodeMutation,
  useConfirmCaseMergeMutation,
  useGetAlertsQuery,
  useGetAuditLogsQuery,
  useGetCaseWorkspaceQuery,
  useGetCasesQuery,
  useGetDashboardQuery,
  useGetMergePreviewQuery,
  useLazyGetMergePreviewQuery,
  useLinkAlertsToCaseMutation,
  useResetMockDataMutation,
  useReviewConclusionMutation,
  useSaveConclusionMutation,
  useTransitionCaseMutation,
  useUpdateAlertStatusMutation,
  useUpdateGraphNodeMutation,
} = bankApi;

export type { RiskLevel };
