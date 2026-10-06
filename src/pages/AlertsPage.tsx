import {
  Button,
  Checkbox,
  Group,
  MultiSelect,
  NumberFormatter,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  EyeOff,
  Link2,
  RotateCcw,
  Search,
} from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertStatusBadge,
  RiskBadge,
} from "../components/Badges";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import {
  resetAlertFilters,
  setAlertFilters,
  setAlertSelection,
  setCaseTargetId,
} from "../features/alerts/alertsSlice";
import {
  useGetAlertsQuery,
  useGetCasesQuery,
  useLinkAlertsToCaseMutation,
  useUpdateAlertStatusMutation,
} from "../services/api";

export function AlertsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const filters = useAppSelector((state) => state.alertsUi.filters);
  const selectedIds = useAppSelector(
    (state) => state.alertsUi.selectedAlertIds,
  );
  const caseTargetId = useAppSelector((state) => state.alertsUi.caseTargetId);
  const { data: alerts = [], isFetching } = useGetAlertsQuery(filters);
  const { data: cases = [] } = useGetCasesQuery();
  const [linkAlerts, { isLoading: isLinking }] = useLinkAlertsToCaseMutation();
  const [updateStatus] = useUpdateAlertStatusMutation();

  const allCurrentSelected =
    alerts.length > 0 && alerts.every((item) => selectedIds.includes(item.id));

  const channels = useMemo(
    () =>
      Array.from(new Set(alerts.map((item) => item.channel))).map((channel) => ({
        value: channel,
        label: channel,
      })),
    [alerts],
  );

  const handleLink = async () => {
    if (selectedIds.length === 0 || !caseTargetId) {
      notifications.show({
        color: "red",
        title: "无法关联",
        message: "请选择至少一条告警和目标案件。",
      });
      return;
    }
    try {
      const result = await linkAlerts({
        alertIds: selectedIds,
        caseId: caseTargetId,
      }).unwrap();
      notifications.show({
        color: "teal",
        title: "关联完成",
        message: `${result.length} 条告警已加入 ${caseTargetId}。`,
      });
      dispatch(setAlertSelection([]));
    } catch (error) {
      const message =
        typeof error === "object" && error && "error" in error
          ? String(error.error)
          : "关联失败，请重试。";
      notifications.show({ color: "red", title: "关联失败", message });
    }
  };

  const handleDismiss = async () => {
    if (selectedIds.length === 0) {
      return;
    }
    await Promise.all(
      selectedIds.map((alertId) =>
        updateStatus({ alertId, status: "dismissed" }).unwrap(),
      ),
    );
    notifications.show({
      color: "gray",
      title: "已排除",
      message: `${selectedIds.length} 条告警已标记为已排除并写入审计。`,
    });
    dispatch(setAlertSelection([]));
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>告警中心</Title>
          <Text c="dimmed" size="sm" mt={4}>
            对账户、设备、IP 和交易线索进行组合筛选，再批量加入案件。
          </Text>
        </div>
        <Text size="sm" c="dimmed">
          {isFetching ? "正在刷新本地服务..." : `共 ${alerts.length} 条结果`}
        </Text>
      </Group>

      <Paper withBorder p="md">
        <Group align="flex-end" grow>
          <TextInput
            label="关键词"
            placeholder="告警编号、账户、设备、IP 或标签"
            leftSection={<Search size={16} />}
            value={filters.keyword}
            onChange={(event) =>
              dispatch(setAlertFilters({ keyword: event.currentTarget.value }))
            }
          />
          <Select
            label="风险等级"
            value={filters.riskLevel}
            onChange={(value) =>
              dispatch(
                setAlertFilters({
                  riskLevel:
                    (value as typeof filters.riskLevel | null) ?? "all",
                }),
              )
            }
            data={[
              { value: "all", label: "全部风险" },
              { value: "high", label: "高风险" },
              { value: "medium", label: "中风险" },
              { value: "low", label: "低风险" },
            ]}
          />
          <Select
            label="处置状态"
            value={filters.status}
            onChange={(value) =>
              dispatch(
                setAlertFilters({
                  status: (value as typeof filters.status | null) ?? "all",
                }),
              )
            }
            data={[
              { value: "all", label: "全部状态" },
              { value: "new", label: "待分诊" },
              { value: "triage", label: "研判中" },
              { value: "linked", label: "已关联案件" },
              { value: "dismissed", label: "已排除" },
            ]}
          />
          <MultiSelect
            label="渠道"
            placeholder="全部渠道"
            data={channels}
            value={filters.channel ? [filters.channel] : []}
            onChange={(value) =>
              dispatch(setAlertFilters({ channel: value[0] ?? "" }))
            }
            clearable
          />
          <Button
            variant="default"
            leftSection={<RotateCcw size={16} />}
            onClick={() => dispatch(resetAlertFilters())}
          >
            重置筛选
          </Button>
        </Group>
      </Paper>

      <Paper withBorder>
        <Group justify="space-between" p="md">
          <Text size="sm" fw={600}>
            已选择 {selectedIds.length} 条
          </Text>
          <Group>
            <Select
              w={260}
              aria-label="目标案件"
              value={caseTargetId}
              onChange={(value) => dispatch(setCaseTargetId(value ?? ""))}
              data={cases.map((item) => ({
                value: item.id,
                label: `${item.id} ${item.title}`,
              }))}
            />
            <Button
              leftSection={<Link2 size={16} />}
              onClick={handleLink}
              loading={isLinking}
            >
              关联到案件
            </Button>
            <Button
              variant="light"
              color="gray"
              leftSection={<EyeOff size={16} />}
              disabled={selectedIds.length === 0}
              onClick={handleDismiss}
            >
              批量排除
            </Button>
          </Group>
        </Group>
        <Table.ScrollContainer minWidth={1120}>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={42}>
                  <Checkbox
                    aria-label="选择当前结果"
                    checked={allCurrentSelected}
                    indeterminate={
                      selectedIds.length > 0 && !allCurrentSelected
                    }
                    onChange={(event) =>
                      dispatch(
                        setAlertSelection(
                          event.currentTarget.checked
                            ? alerts.map((item) => item.id)
                            : [],
                        ),
                      )
                    }
                  />
                </Table.Th>
                <Table.Th>告警信息</Table.Th>
                <Table.Th>账户 / 对手方</Table.Th>
                <Table.Th>设备 / IP</Table.Th>
                <Table.Th>金额</Table.Th>
                <Table.Th>风险</Table.Th>
                <Table.Th>状态</Table.Th>
                <Table.Th>时间</Table.Th>
                <Table.Th>案件</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {alerts.map((alert) => (
                <Table.Tr key={alert.id}>
                  <Table.Td>
                    <Checkbox
                      aria-label={`选择 ${alert.id}`}
                      checked={selectedIds.includes(alert.id)}
                      onChange={() =>
                        dispatch(
                          setAlertSelection(
                            selectedIds.includes(alert.id)
                              ? selectedIds.filter((id) => id !== alert.id)
                              : [...selectedIds, alert.id],
                          ),
                        )
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {alert.title}
                    </Text>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {alert.id} · {alert.channel}
                    </Text>
                    <Text size="xs" c="dimmed" mt={4}>
                      {alert.tags.join(" / ")}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{alert.account}</Text>
                    <Text size="xs" c="dimmed">
                      对手方 {alert.counterparty}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {alert.deviceId}
                    </Text>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {alert.ip}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <NumberFormatter
                      value={alert.amount}
                      thousandSeparator
                      prefix="¥"
                    />
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={4}>
                      <RiskBadge value={alert.riskLevel} />
                      <Text size="xs" c="dimmed">
                        评分 {alert.score}
                      </Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <AlertStatusBadge value={alert.status} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">
                      {new Date(alert.detectedAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {alert.caseId ? (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        onClick={() => navigate(`/cases/${alert.caseId}`)}
                      >
                        打开案件
                      </Button>
                    ) : (
                      <Text size="xs" c="dimmed">
                        未关联
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
