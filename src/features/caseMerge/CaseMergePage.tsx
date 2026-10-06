import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Stepper,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Combine,
  FileWarning,
  GitMerge,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ConclusionStatusBadge,
  EvidenceStrengthBadge,
  RiskBadge,
} from "../../components/Badges";
import type {
  ConclusionStatus,
  EdgeKind,
  EvidenceStrength,
  NodeKind,
} from "../../models/types";
import {
  useConfirmCaseMergeMutation,
  useGetCasesQuery,
  useLazyGetMergePreviewQuery,
} from "../../services/api";
import type {
  MergeConflict,
  MergeEntityKind,
  MergePreview,
} from "../caseMerge/mergeCases";

const nodeKindLabels: Record<NodeKind, string> = {
  account: "账户",
  device: "设备",
  ip: "IP",
  merchant: "商户",
};

const edgeKindLabels: Record<EdgeKind, string> = {
  transfer: "转账",
  shared_device: "共用设备",
  shared_ip: "共用 IP",
  payee: "收款方",
};

const entityLabels: Record<MergeEntityKind, string> = {
  case: "案件",
  alert: "告警",
  node: "图谱节点",
  edge: "关系",
  evidence: "证据",
  conclusion: "结论版本",
};

const changeLabels: Record<MergeConflict["change"], string> = {
  added: "新增",
  removed: "删除/移出",
  modified: "被修改",
};

const changeColors: Record<MergeConflict["change"], string> = {
  added: "blue",
  removed: "red",
  modified: "orange",
};

const errorMessage = (error: unknown): string => {
  if (typeof error === "object" && error && "error" in error) {
    return String(error.error);
  }
  return "操作失败，请重试。";
};

const getConflicts = (error: unknown): MergeConflict[] => {
  if (typeof error === "object" && error && error !== null) {
    const record = error as Record<string, unknown>;
    if (record.status === "MERGE_CONFLICT" && Array.isArray(record.conflicts)) {
      return record.conflicts as MergeConflict[];
    }
  }
  return [];
};

function ConflictList({ conflicts }: { conflicts: MergeConflict[] }) {
  const grouped = useMemo(() => {
    const sides: Array<{
      side: "source" | "target";
      title: (preview: MergePreview | null) => string;
      items: MergeConflict[];
    }> = [
      { side: "source", title: () => "来源案件侧变更", items: [] },
      { side: "target", title: () => "目标案件侧变更", items: [] },
    ];
    conflicts.forEach((conflict) => {
      sides.find((item) => item.side === conflict.side)?.items.push(conflict);
    });
    return sides.filter((item) => item.items.length > 0);
  }, [conflicts]);

  return (
    <Alert
      color="red"
      icon={<FileWarning size={18} />}
      title="检测到并发修改，并案已中止"
      mt="lg"
    >
      <Stack gap="sm">
        <Text size="sm">
          预览生成后有人同时修改了案件数据。为避免关系、证据与结论错挂，系统没有写入任何数据，不存在半迁移。请重新生成预览并核对后再确认。
        </Text>
        {grouped.map((group) => (
          <Paper key={group.side} withBorder p="xs">
            <Text fw={600} size="sm" mb={6}>
              {group.side === "source" ? "来源案件" : "目标案件"} ·{" "}
              {group.items.length} 处变更
            </Text>
            <Table.ScrollContainer minWidth={520}>
              <Table verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>类型</Table.Th>
                    <Table.Th>数据</Table.Th>
                    <Table.Th>变化</Table.Th>
                    <Table.Th>说明</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {group.items.map((item, index) => (
                    <Table.Tr key={`${item.id}-${index}`}>
                      <Table.Td>{entityLabels[item.entity]}</Table.Td>
                      <Table.Td>
                        <Text size="sm">{item.label}</Text>
                        <Text size="xs" c="dimmed" ff="monospace">
                          {item.id}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={changeColors[item.change]} variant="light">
                          {changeLabels[item.change]}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {item.detail}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        ))}
      </Stack>
    </Alert>
  );
}

function PreviewSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Paper withBorder p="md">
      <Text fw={600}>{title}</Text>
      {hint ? (
        <Text size="xs" c="dimmed" mt={3} mb="sm">
          {hint}
        </Text>
      ) : null}
      {children}
    </Paper>
  );
}

export function CaseMergePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: cases = [], isLoading } = useGetCasesQuery();

  const [sourceCaseId, setSourceCaseId] = useState<string>(
    searchParams.get("from") ?? "",
  );
  const [targetCaseId, setTargetCaseId] = useState<string>(
    searchParams.get("into") ?? "",
  );
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [conflicts, setConflicts] = useState<MergeConflict[]>([]);
  const [fetchPreview, { isFetching: isPreviewing }] =
    useLazyGetMergePreviewQuery();
  const [confirmMerge, { isLoading: isMerging }] =
    useConfirmCaseMergeMutation();

  const selectableSources = cases.filter(
    (item) => item.id !== targetCaseId && !item.mergedIntoCaseId,
  );
  const selectableTargets = cases.filter(
    (item) => item.id !== sourceCaseId && !item.mergedIntoCaseId,
  );

  const canPreview =
    Boolean(sourceCaseId) &&
    Boolean(targetCaseId) &&
    sourceCaseId !== targetCaseId;

  const handlePreview = async () => {
    if (!canPreview) {
      return;
    }
    setConflicts([]);
    try {
      const result = await fetchPreview({
        sourceCaseId,
        targetCaseId,
      }, true).unwrap();
      setPreview(result);
      setActive(1);
    } catch (error) {
      notifications.show({
        color: "red",
        title: "无法生成预览",
        message: errorMessage(error),
      });
    }
  };

  const handleConfirm = async () => {
    if (!preview) {
      return;
    }
    try {
      await confirmMerge({ preview }).unwrap();
      setActive(2);
      notifications.show({
        color: "teal",
        title: "并案完成",
        message: `${preview.sourceCaseTitle} 已归入 ${preview.targetCaseTitle}。`,
      });
    } catch (error) {
      const found = getConflicts(error);
      if (found.length > 0) {
        setConflicts(found);
      } else {
        notifications.show({
          color: "red",
          title: "并案失败",
          message: errorMessage(error),
        });
      }
    }
  };

  const handleResetPreview = async () => {
    setConflicts([]);
    await handlePreview();
  };

  if (isLoading) {
    return <Text>正在加载案件...</Text>;
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Group align="flex-start">
          <Button
            variant="subtle"
            px={6}
            leftSection={<ArrowLeft size={16} />}
            onClick={() => navigate("/cases")}
          >
            返回案件
          </Button>
          <div>
            <Group gap="sm">
              <Title order={2}>并案处理</Title>
              <Badge color="teal" variant="light" leftSection={<Combine size={12} />}>
                原子迁移
              </Badge>
            </Group>
            <Text c="dimmed" size="sm" mt={4}>
              先预览告警、图谱节点、关系、证据和结论版本，确认后整体归入目标案件；预览后案件被改动会列出冲突并中止。
            </Text>
          </div>
        </Group>
      </Group>

      <Stepper active={active} onStepClick={setActive} allowNextStepsSelect={false}>
        <Stepper.Step label="选择案件" description="来源与目标">
          <Paper withBorder p="lg" mt="md">
            <Select
              label="来源案件（将被整体归入并关闭）"
              placeholder="选择需要并案的案件"
              searchable
              required
              data={selectableSources.map((item) => ({
                value: item.id,
                label: `${item.id} · ${item.title}`,
              }))}
              value={sourceCaseId || null}
              onChange={(value) => {
                setSourceCaseId(value ?? "");
                setPreview(null);
                setConflicts([]);
              }}
            />
            <Select
              label="目标案件（并案后的主案件）"
              placeholder="选择承接数据的案件"
              searchable
              required
              mt="md"
              data={selectableTargets.map((item) => ({
                value: item.id,
                label: `${item.id} · ${item.title}`,
              }))}
              value={targetCaseId || null}
              onChange={(value) => {
                setTargetCaseId(value ?? "");
                setPreview(null);
                setConflicts([]);
              }}
            />
            {sourceCaseId && targetCaseId && sourceCaseId === targetCaseId ? (
              <Alert color="red" mt="md" icon={<AlertTriangle size={16} />}>
                来源案件与目标案件不能相同。
              </Alert>
            ) : null}
            <Group justify="flex-end" mt="lg">
              <Button
                leftSection={<GitMerge size={16} />}
                disabled={!canPreview}
                loading={isPreviewing}
                onClick={handlePreview}
              >
                生成并案预览
              </Button>
            </Group>
          </Paper>
        </Stepper.Step>

        <Stepper.Step label="预览确认" description="核对迁移内容">
          {preview ? (
            <Stack gap="md" mt="md">
              <Alert color="blue" icon={<GitMerge size={18} />}>
                <Group justify="space-between">
                  <Text size="sm">
                    {preview.sourceCaseTitle}（{preview.sourceCaseId} · R
                    {preview.sourceRevision}）将归入 →{" "}
                    {preview.targetCaseTitle}（{preview.targetCaseId} · R
                    {preview.targetRevision}）
                  </Text>
                </Group>
                <Group gap="xs" mt="sm">
                  <Badge variant="light">{preview.counts.alerts} 条告警</Badge>
                  <Badge color="teal" variant="light">
                    节点复用 {preview.counts.nodesReuse} / 迁入{" "}
                    {preview.counts.nodesMove}
                  </Badge>
                  <Badge color="teal" variant="light">
                    关系复用 {preview.counts.edgesReuse} / 迁入{" "}
                    {preview.counts.edgesMove}
                  </Badge>
                  <Badge color="grape" variant="light">
                    证据 {preview.counts.evidence} 份
                  </Badge>
                  <Badge color="orange" variant="light">
                    结论迁入 {preview.counts.conclusionsMove} / 快照{" "}
                    {preview.counts.conclusionsSnapshot}
                  </Badge>
                </Group>
              </Alert>

              <PreviewSection
                title="告警"
                hint="全部告警改挂目标案件，保留原处置状态。"
              >
                <Table.ScrollContainer minWidth={720}>
                  <Table verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>告警编号</Table.Th>
                        <Table.Th>标题</Table.Th>
                        <Table.Th>账户</Table.Th>
                        <Table.Th>金额</Table.Th>
                        <Table.Th>风险</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {preview.alerts.map((item) => (
                        <Table.Tr key={item.id}>
                          <Table.Td>
                            <Text size="sm" ff="monospace">
                              {item.id}
                            </Text>
                          </Table.Td>
                          <Table.Td>{item.title}</Table.Td>
                          <Table.Td>{item.account}</Table.Td>
                          <Table.Td>
                            ¥{item.amount.toLocaleString("zh-CN")}
                          </Table.Td>
                          <Table.Td>
                            <RiskBadge value={item.riskLevel} />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                      {preview.alerts.length === 0 ? (
                        <Table.Tr>
                          <Table.Td>
                            <Text size="sm" c="dimmed">
                              来源案件当前无归属告警。
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ) : null}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </PreviewSection>

              <PreviewSection
                title="图谱节点"
                hint="目标案件已有同类型、同名节点时直接复用，并把挂在上面的关系重映射到该节点。"
              >
                <Table.ScrollContainer minWidth={720}>
                  <Table verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>处理</Table.Th>
                        <Table.Th>节点</Table.Th>
                        <Table.Th>类型</Table.Th>
                        <Table.Th>说明</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {preview.nodePlans.map((item) => (
                        <Table.Tr key={item.sourceNodeId}>
                          <Table.Td>
                            <Badge
                              color={item.kind === "reuse" ? "teal" : "blue"}
                              variant="light"
                            >
                              {item.kind === "reuse" ? "复用现有" : "整节点迁入"}
                            </Badge>
                          </Table.Td>
                          <Table.Td>{item.label}</Table.Td>
                          <Table.Td>{nodeKindLabels[item.nodeKind]}</Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {item.reason}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                      {preview.nodePlans.length === 0 ? (
                        <Table.Tr>
                          <Table.Td>
                            <Text size="sm" c="dimmed">
                              来源案件没有图谱节点。
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ) : null}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </PreviewSection>

              <PreviewSection
                title="关系"
                hint="端点经同名节点重映射后，目标案件已有同类型、同端点关系时直接复用，不产生重复关系。"
              >
                <Table.ScrollContainer minWidth={720}>
                  <Table verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>处理</Table.Th>
                        <Table.Th>关系</Table.Th>
                        <Table.Th>类型</Table.Th>
                        <Table.Th>说明</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {preview.edgePlans.map((item) => (
                        <Table.Tr key={item.sourceEdgeId}>
                          <Table.Td>
                            <Badge
                              color={item.kind === "reuse" ? "teal" : "blue"}
                              variant="light"
                            >
                              {item.kind === "reuse" ? "复用现有" : "随节点迁入"}
                            </Badge>
                          </Table.Td>
                          <Table.Td>{item.label}</Table.Td>
                          <Table.Td>{edgeKindLabels[item.edgeKind]}</Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {item.reason}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                      {preview.edgePlans.length === 0 ? (
                        <Table.Tr>
                          <Table.Td>
                            <Text size="sm" c="dimmed">
                              来源案件没有关系数据。
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ) : null}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </PreviewSection>

              <PreviewSection
                title="证据"
                hint="证据台账随案件整体迁入，来源、时间、提交人和版本记录保持不变。"
              >
                <Table.ScrollContainer minWidth={760}>
                  <Table verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>证据名称</Table.Th>
                        <Table.Th>来源</Table.Th>
                        <Table.Th>强度</Table.Th>
                        <Table.Th>发生时间</Table.Th>
                        <Table.Th>提交人</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {preview.evidence.map((item) => (
                        <Table.Tr key={item.id}>
                          <Table.Td>{item.title}</Table.Td>
                          <Table.Td>{item.source}</Table.Td>
                          <Table.Td>
                            <EvidenceStrengthBadge
                              value={item.strength as EvidenceStrength}
                            />
                          </Table.Td>
                          <Table.Td>
                            {new Date(item.occurredAt).toLocaleString("zh-CN", {
                              hour12: false,
                            })}
                          </Table.Td>
                          <Table.Td>{item.submittedBy}</Table.Td>
                        </Table.Tr>
                      ))}
                      {preview.evidence.length === 0 ? (
                        <Table.Tr>
                          <Table.Td>
                            <Text size="sm" c="dimmed">
                              来源案件没有证据。
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ) : null}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </PreviewSection>

              <PreviewSection
                title="结论版本"
                hint="已提交复核（含已通过、已退回）的结论只保留只读快照；草稿顺延目标案件版本号后可继续编辑。"
              >
                <Table.ScrollContainer minWidth={820}>
                  <Table verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>处理</Table.Th>
                        <Table.Th>源版本</Table.Th>
                        <Table.Th>目标版本</Table.Th>
                        <Table.Th>状态</Table.Th>
                        <Table.Th>说明</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {preview.conclusionPlans.map((item) => (
                        <Table.Tr key={item.sourceConclusionId}>
                          <Table.Td>
                            <Badge
                              color={
                                item.kind === "snapshot" ? "orange" : "blue"
                              }
                              variant="light"
                            >
                              {item.kind === "snapshot" ? "只读快照" : "草稿迁入"}
                            </Badge>
                          </Table.Td>
                          <Table.Td>V{item.sourceVersion}</Table.Td>
                          <Table.Td>
                            {item.kind === "snapshot"
                              ? `保留 V${item.sourceVersion}`
                              : `V${item.targetVersion}`}
                          </Table.Td>
                          <Table.Td>
                            <ConclusionStatusBadge
                              value={item.status as ConclusionStatus}
                            />
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {item.reason}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                      {preview.conclusionPlans.length === 0 ? (
                        <Table.Tr>
                          <Table.Td>
                            <Text size="sm" c="dimmed">
                              来源案件没有结论版本。
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ) : null}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </PreviewSection>

              <Alert color="orange" icon={<AlertTriangle size={18} />}>
                确认时会再次校验双方案件。若预览后有人修改过任一案件，系统将列出全部冲突并中止，不会写入任何数据。
              </Alert>

              {conflicts.length > 0 ? <ConflictList conflicts={conflicts} /> : null}

              <Group justify="space-between">
                <Button
                  variant="default"
                  onClick={() => setActive(0)}
                  disabled={isMerging}
                >
                  重新选择案件
                </Button>
                <Group>
                  {conflicts.length > 0 ? (
                    <Button
                      variant="light"
                      leftSection={<GitMerge size={16} />}
                      loading={isPreviewing}
                      onClick={handleResetPreview}
                    >
                      重新生成预览
                    </Button>
                  ) : null}
                  <Button
                    size="md"
                    color="teal"
                    leftSection={<Check size={18} />}
                    loading={isMerging}
                    disabled={conflicts.length > 0}
                    onClick={handleConfirm}
                >
                    确认归入 {preview.targetCaseId}
                  </Button>
                </Group>
              </Group>
            </Stack>
          ) : (
            <Paper withBorder p="xl" mt="md">
              <Text c="dimmed">请返回上一步选择来源与目标案件并生成预览。</Text>
            </Paper>
          )}
        </Stepper.Step>

        <Stepper.Step label="完成" description="并案结果">
          {preview ? (
            <Paper withBorder p="xl" mt="md">
              <Stack align="center" gap="sm">
                <Check size={40} color="var(--mantine-color-teal-6)" />
                <Title order={3}>并案已完成</Title>
                <Text size="sm" c="dimmed" ta="center">
                  {preview.sourceCaseTitle} 的告警、节点、关系、证据和结论已归入{" "}
                  {preview.targetCaseTitle}。来源案件已关闭并保留审计与结论快照。
                </Text>
                <Group mt="md">
                  <Button
                    variant="default"
                    onClick={() =>
                      navigate(`/cases/${preview.sourceCaseId}`)
                    }
                  >
                    查看来源案件（只读壳）
                  </Button>
                  <Button onClick={() => navigate(`/cases/${preview.targetCaseId}`)}>
                    打开目标案件工作台
                  </Button>
                </Group>
              </Stack>
            </Paper>
          ) : null}
        </Stepper.Step>
      </Stepper>
    </Stack>
  );
}
