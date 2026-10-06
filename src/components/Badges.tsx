import { Badge } from "@mantine/core";
import type {
  AlertStatus,
  CaseStatus,
  ConclusionStatus,
  EvidenceStrength,
  RiskLevel,
} from "../models/types";

const riskMap: Record<
  RiskLevel,
  { color: string; label: string; order: number }
> = {
  high: { color: "red", label: "高风险", order: 3 },
  medium: { color: "orange", label: "中风险", order: 2 },
  low: { color: "gray", label: "低风险", order: 1 },
};

const alertStatusMap: Record<AlertStatus, { color: string; label: string }> = {
  new: { color: "blue", label: "待分诊" },
  triage: { color: "orange", label: "研判中" },
  linked: { color: "teal", label: "已关联案件" },
  dismissed: { color: "gray", label: "已排除" },
};

const caseStatusMap: Record<CaseStatus, { color: string; label: string }> = {
  investigating: { color: "blue", label: "调查中" },
  pending_review: { color: "orange", label: "待复核" },
  supplement: { color: "yellow", label: "待补证" },
  closed: { color: "teal", label: "已关闭" },
};

const evidenceMap: Record<
  EvidenceStrength,
  { color: string; label: string }
> = {
  strong: { color: "teal", label: "强证据" },
  medium: { color: "orange", label: "中等证据" },
  weak: { color: "gray", label: "弱证据" },
};

const conclusionMap: Record<
  ConclusionStatus,
  { color: string; label: string }
> = {
  draft: { color: "gray", label: "草稿" },
  submitted: { color: "orange", label: "待复核" },
  approved: { color: "teal", label: "已通过" },
  returned: { color: "red", label: "已退回" },
};

interface BadgeProps<T extends string> {
  value: T;
}

export function RiskBadge({ value }: BadgeProps<RiskLevel>) {
  const config = riskMap[value];
  return (
    <Badge color={config.color} variant="light">
      {config.label}
    </Badge>
  );
}

export function AlertStatusBadge({ value }: BadgeProps<AlertStatus>) {
  const config = alertStatusMap[value];
  return (
    <Badge color={config.color} variant="light">
      {config.label}
    </Badge>
  );
}

export function CaseStatusBadge({ value }: BadgeProps<CaseStatus>) {
  const config = caseStatusMap[value];
  return (
    <Badge color={config.color} variant="light">
      {config.label}
    </Badge>
  );
}

export function EvidenceStrengthBadge({
  value,
}: BadgeProps<EvidenceStrength>) {
  const config = evidenceMap[value];
  return (
    <Badge color={config.color} variant="light">
      {config.label}
    </Badge>
  );
}

export function ConclusionStatusBadge({
  value,
}: BadgeProps<ConclusionStatus>) {
  const config = conclusionMap[value];
  return (
    <Badge color={config.color} variant="light">
      {config.label}
    </Badge>
  );
}

export const riskOrder = (risk: RiskLevel): number => riskMap[risk].order;
export const riskLabel = (risk: RiskLevel): string => riskMap[risk].label;
export const caseStatusLabel = (status: CaseStatus): string =>
  caseStatusMap[status].label;
