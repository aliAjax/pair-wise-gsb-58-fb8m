import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  AlertTriangle,
  ArrowRight,
  Copy,
  GitMerge,
  History,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  edgeKindLabels,
  nodeKindLabels,
  type CaseMergePreview,
  type MergeConflict,
} from "../services/caseMerge";
import {
  useCommitCaseMergeMutation,
  useGetCasesQuery,
  useLazyMergeCasePreviewQuery,
  type MergeConflictResponse,
} from "../services/api";
import {
  CaseStatusBadge,
  ConclusionStatusBadge,
  RiskBadge,
} from "./Badges";

interface MergeCasesModalProps {
  opened: boolean;
  onClose: () => void;
  sourceCaseId: string;
  onMerged?: (targetCaseId: string) => void;
}

const errorText = (error: unknown): string => {
  if (typeof error === "object" && error && "error" in error) {
    return String(error.error);
  }
  return "操作失败，请稍后重试。";
};

const extractConflict = (error: unknown): MergeConflictResponse | undefined => {
  if (
    typeof error === "object" &&
    error &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    (error.data as { code?: string }).code === "MERGE_CONFLICT"
  ) {
    return error.data as MergeConflictResponse;
  }
  return undefined;
};

const conflictGroupLabels: Record<string, string> = {
  case: "案件信息",
  alert: "告警",
  node: "图谱节点",
  edge: "关系",
  evidence: "证据",
  conclusion: "结论版本",
};

const conflictKindLabels: Record<MergeConflict["kind"], string> = {
  added: "新增",
  removed: "删除",
  modified: "修改",
  revision: "版本变化",
};

const formatTime = (value: string): string =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });

export function MergeCasesModal({
  opened,
  onClose,
  sourceCaseId,
  onMerged,
}: MergeCasesModalProps) {
  const { data: cases = [] } = useGetCasesQuery();
  const [targetCaseId, setTargetCaseId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CaseMergePreview | null>(null);
  const [conflicts, setConflicts] = useState<MergeConflict[]>([]);
  const [fetchPreview, { isFetching: isPreviewing }] =
    useLazyMergeCasePreviewQuery();
  const [commitMerge, { isLoading: isCommitting }] =
    useCommitCaseMergeMutation();

  const sourceCase = cases.find((item) => item.id === sourceCaseId);

  const targetOptions = useMemo(
    () =>
      cases
        .filter(
          (item) =>
            item.id !== sourceCaseId &&
            !item.mergedIntoCaseId &&
            !sourceCase?.mergedIntoCaseId,
        )
        .map((item) => ({
          value: item.id,
          label: `${item.id} · ${item.title}（${item.alertIds.length} 条告警）`,
        })),
    [cases, sourceCaseId, sourceCase?.mergedIntoCaseId],
  );

  const resetState = () => {
    setPreview(null);
    setConflicts([]);
    setTargetCaseId(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handlePreview = async () => {
    if (!targetCaseId) {
      notifications.show({
        color: "red",
        title: "请选择目标案件",
        message: "并案需要一个归入的目标案件。",
      });
      return;
    }
    setConflicts([]);
    try {
      const result = await fetchPreview({
        sourceCaseId,
        targetCaseId,
      }).unwrap();
      setPreview(result);
    } catch (error) {
      setPreview(null);
      notifications.show({
        color: "red",
        title: "预览生成失败",
        message: errorText(error),
      });
    }
  };

  const handleCommit = async () => {
    if (!preview) {
      return;
    }
    try {
      const result = await commitMerge({
        sourceCaseId,
        targetCaseId: preview.targetCase.id,
        token: preview.token,
      }).unwrap();
      notifications.show({
        color: "teal",
        title: "并案完成",
        message:
          `已归入 ${result.targetCaseId}：` +
          `${result.movedAlertIds.length} 条告警、${result.nodeCreated} 个新节点、` +
          `${result.nodesReused} 个节点复用，结论 ${result.draftsMoved} 版并入、${result.snapshotted} 版留快照。`,
      });
      const mergedTarget = result.targetCaseId;
      handleClose();
      onMerged?.(mergedTarget);
    } catch (error) {
      const conflict = extractConflict(error);
      if (conflict) {
        setConflicts(conflict.conflicts);
        notifications.show({
          color: "red",
          title: "确认已过期",
          message: "预览后案件被修改，请核对冲突后重新预览。",
        });
      } else {
        notifications.show({
          color: "red",
          title: "并案失败",
          message: errorText(error),
        });
      }
    }
  };

  const groupedConflicts = useMemo(() => {
    const groups = new Map<string, MergeConflict[]>();
    conflicts.forEach((item) => {
      const key = `${item.side === "source" ? "源案件" : "目标案件"} · ${
        conflictGroupLabels[item.entity]
      }`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return Array.from(groups.entries());
  }, [conflicts]);

  const plan = preview?.plan;

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="xs">
          <GitMerge size={18} />
          <span>并案处理</span>
        </Group>
      }
      size="4xl"
      closeOnClickOutside={false}
    >
      <Stack gap="md">
        {sourceCase?.mergedIntoCaseId ? (
          <Alert color="blue" icon={<History size={16} />} title="案件已并案">
            {sourceCase.title} 已并入 {sourceCase.mergedIntoCaseId}
            ，原案件已关闭，不能再次并案。
          </Alert>
        ) : null}

        <Paper withBorder p="md">
          <Group align="flex-end" grow>
            <div>
              <Text size="xs" c="dimmed">
                源案件（迁出并关闭）
              </Text>
              {sourceCase ? (
                <Stack gap={4} mt={4}>
                  <Group gap="xs">
                    <Text fw={600} ff="monospace" size="sm">
                      {sourceCase.id}
                    </Text>
                    <RiskBadge value={sourceCase.riskLevel} />
                    <CaseStatusBadge value={sourceCase.status} />
                  </Group>
                  <Text size="sm">{sourceCase.title}</Text>
                  <Text size="xs" c="dimmed">
                    工作区版本 V{sourceCase.revision}
                  </Text>
                </Stack>
              ) : (
                <Text size="sm" c="dimmed" mt={4}>
                  未找到源案件
                </Text>
              )}
            </div>
            <Group justify="center" align="center" pb="md">
              <ArrowRight size={20} />
            </Group>
            <Select
              label="目标案件（归入）"
              placeholder="选择同一账户群的目标案件"
              searchable
              value={targetCaseId}
              disabled={Boolean(sourceCase?.mergedIntoCaseId)}
              onChange={(value) => {
                setTargetCaseId(value);
                setPreview(null);
                setConflicts([]);
              }}
              data={targetOptions}
            />
          </Group>
          <Group justify="flex-end" mt="md">
            <Button
              variant="light"
              leftSection={
                isPreviewing ? (
                  <Loader size={14} />
                ) : (
                  <Sparkles size={16} />
                )
              }
              loading={isPreviewing}
              disabled={
                !targetCaseId ||
                targetCaseId === sourceCaseId ||
                Boolean(sourceCase?.mergedIntoCaseId)
              }
              onClick={handlePreview}
            >
              {preview ? "重新生成预览" : "生成并案预览"}
            </Button>
          </Group>
        </Paper>

        {preview && plan ? (
          <>
            <Alert color="teal" icon={<GitMerge size={16} />}>
              预览生成于 {formatTime(preview.token.issuedAt)}
              。确认前若任一案件被修改，系统将列出冲突并停止并案，不会产生半迁移数据。
              已提交复核的结论（待复核 / 已通过 / 已退回）仅以只读快照保留。
            </Alert>

            <Group gap="xs">
              <Badge variant="light" color="teal">
                告警 {plan.alerts.length}
              </Badge>
              <Badge variant="light">
                节点 新建 {plan.nodes.filter((item) => item.action === "create").length} /
                复用 {plan.nodes.filter((item) => item.action === "reuse").length}
              </Badge>
              <Badge variant="light">
                关系 迁入 {plan.edges.filter((item) => item.action === "migrate").length} /
                复用 {plan.edges.filter((item) => item.action === "reuse").length}
              </Badge>
              <Badge variant="light" color="teal">
                证据 {plan.evidence.length}
              </Badge>
              <Badge variant="light" color="blue">
                草稿并入 {plan.conclusions.filter((item) => item.action === "migrate").length}
              </Badge>
              <Badge variant="light" color="orange">
                快照 {plan.conclusions.filter((item) => item.action === "snapshot").length}
              </Badge>
            </Group>

            <ScrollArea.Autosize mah={380}>
              <Stack gap="md" pr="xs">
                <PreviewSection
                  title="告警"
                  emptyText="源案件没有待迁移告警"
                  count={plan.alerts.length}
                >
                  <CompactTable
                    headers={["告警编号", "标题", "账户", "风险", "处理"]}
                    rows={plan.alerts.map((item) => [
                      <Mono key="id">{item.alertId}</Mono>,
                      <Text key="title" size="xs">
                        {item.title}
                      </Text>,
                      <Mono key="acc">{item.account}</Mono>,
                      <RiskBadge key="risk" value={item.riskLevel} />,
                      <ActionBadge key="a" color="teal" icon={<ArrowRight size={12} />}>
                        归入
                      </ActionBadge>,
                    ])}
                  />
                </PreviewSection>

                <PreviewSection
                  title="图谱节点"
                  emptyText="源案件没有图谱节点"
                  count={plan.nodes.length}
                >
                  <CompactTable
                    headers={["节点", "类型", "风险", "处理"]}
                    rows={plan.nodes.map((item) => [
                      <Text key="label" size="xs" fw={600}>
                        {item.label}
                      </Text>,
                      <Text key="kind" size="xs">
                        {nodeKindLabels[item.kind]}
                      </Text>,
                      <RiskBadge key="risk" value={item.riskLevel} />,
                      item.action === "reuse" ? (
                        <ActionBadge key="a" color="blue" icon={<Copy size={12} />}>
                          复用同名节点{item.targetNodeId ? ` ${item.targetNodeId}` : ""}
                        </ActionBadge>
                      ) : (
                        <ActionBadge key="a" color="teal" icon={<Plus size={12} />}>
                          新建并迁入
                        </ActionBadge>
                      ),
                    ])}
                  />
                </PreviewSection>

                <PreviewSection
                  title="关系"
                  emptyText="源案件没有关系数据"
                  count={plan.edges.length}
                >
                  <CompactTable
                    headers={["关系", "起点 → 终点", "类型", "处理"]}
                    rows={plan.edges.map((item) => [
                      <Text key="label" size="xs" fw={600}>
                        {item.label}
                      </Text>,
                      <Text key="path" size="xs">
                        {item.sourceNodeLabel} → {item.targetNodeLabel}
                      </Text>,
                      <Text key="kind" size="xs">
                        {edgeKindLabels[item.kind]}
                      </Text>,
                      item.action === "reuse" ? (
                        <ActionBadge key="a" color="blue" icon={<Copy size={12} />}>
                          复用重复关系
                        </ActionBadge>
                      ) : (
                        <ActionBadge key="a" color="teal" icon={<ArrowRight size={12} />}>
                          迁入并改写端点
                        </ActionBadge>
                      ),
                    ])}
                  />
                </PreviewSection>

                <PreviewSection
                  title="证据"
                  emptyText="源案件没有证据"
                  count={plan.evidence.length}
                >
                  <CompactTable
                    headers={["证据编号", "名称", "强度", "处理"]}
                    rows={plan.evidence.map((item) => [
                      <Mono key="id">{item.evidenceId}</Mono>,
                      <Text key="title" size="xs">
                        {item.title}
                      </Text>,
                      <Text key="s" size="xs">
                        {item.strength === "strong"
                          ? "强"
                          : item.strength === "medium"
                            ? "中"
                            : "弱"}
                      </Text>,
                      <ActionBadge key="a" color="teal" icon={<ArrowRight size={12} />}>
                        迁入台账
                      </ActionBadge>,
                    ])}
                  />
                </PreviewSection>

                <PreviewSection
                  title="结论版本"
                  emptyText="源案件没有结论版本"
                  count={plan.conclusions.length}
                >
                  <CompactTable
                    headers={["版本", "当前状态", "处理"]}
                    rows={plan.conclusions.map((item) => [
                      <Text key="v" size="xs" fw={600}>
                        V{item.version}
                      </Text>,
                      <ConclusionStatusBadge key="s" value={item.status} />,
                      item.action === "migrate" ? (
                        <ActionBadge key="a" color="blue" icon={<GitMerge size={12} />}>
                          草稿续号为目标案件 V{item.targetVersion}
                        </ActionBadge>
                      ) : (
                        <ActionBadge key="a" color="orange" icon={<History size={12} />}>
                          仅留复核快照（V{item.version}）
                        </ActionBadge>
                      ),
                    ])}
                  />
                </PreviewSection>
              </Stack>
            </ScrollArea.Autosize>

            {conflicts.length > 0 ? (
              <Alert
                color="red"
                icon={<AlertTriangle size={16} />}
                title="预览后数据已变化，并案已停止"
              >
                <Stack gap="xs" mt={4}>
                  <Text size="sm">
                    共发现 {conflicts.length}{" "}
                    处冲突。本次确认未写入任何数据，请重新预览后再确认。
                  </Text>
                  {groupedConflicts.map(([group, items]) => (
                    <div key={group}>
                      <Divider
                        labelPosition="left"
                        label={
                          <Text size="xs" fw={700}>
                            {group}
                          </Text>
                        }
                      />
                      {items.map((item, index) => (
                        <Group key={`${item.entity}-${item.entityId}-${index}`} gap="xs" mt={2}>
                          <Badge size="xs" color="red" variant="light">
                            {conflictKindLabels[item.kind]}
                          </Badge>
                          <Text size="xs">{item.detail}</Text>
                        </Group>
                      ))}
                    </div>
                  ))}
                </Stack>
              </Alert>
            ) : null}
          </>
        ) : (
          !isPreviewing && (
            <Alert color="gray" icon={<RefreshCw size={16} />}>
              选择目标案件后生成预览，可核对告警、图谱节点、关系、证据和结论版本的迁移方式。
            </Alert>
          )
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={handleClose}>
            取消
          </Button>
          {conflicts.length > 0 ? (
            <Button
              variant="light"
              leftSection={<RefreshCw size={16} />}
              onClick={handlePreview}
              loading={isPreviewing}
            >
              重新生成预览
            </Button>
          ) : null}
          <Button
            color="teal"
            leftSection={<GitMerge size={16} />}
            disabled={!preview || conflicts.length > 0}
            loading={isCommitting}
            onClick={handleCommit}
          >
            确认归入目标案件
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function PreviewSection({
  title,
  count,
  emptyText,
  children,
}: {
  title: string;
  count: number;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <Paper withBorder>
      <Group justify="space-between" px="sm" py={6}>
        <Text size="sm" fw={600}>
          {title}
        </Text>
        <Text size="xs" c="dimmed">
          {count} 项
        </Text>
      </Group>
      <Divider />
      {count === 0 ? (
        <Text size="xs" c="dimmed" p="sm">
          {emptyText}
        </Text>
      ) : (
        children
      )}
    </Paper>
  );
}

function CompactTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <Table.ScrollContainer minWidth={480}>
      <Table verticalSpacing={6} horizontalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            {headers.map((header) => (
              <Table.Th key={header}>{header}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row, index) => (
            <Table.Tr key={index}>
              {row.map((cell, cellIndex) => (
                <Table.Td key={cellIndex}>{cell}</Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xs" ff="monospace">
      {children}
    </Text>
  );
}

function ActionBadge({
  color,
  icon,
  children,
}: {
  color: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Badge
      color={color}
      variant="light"
      leftSection={icon}
      styles={{ root: { textTransform: "none" } }}
    >
      {children}
    </Badge>
  );
}
