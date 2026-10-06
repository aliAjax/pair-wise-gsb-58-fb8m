import {
  Button,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { ArrowRight, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CaseStatusBadge,
  RiskBadge,
  caseStatusLabel,
} from "../components/Badges";
import { useGetCasesQuery } from "../services/api";
import type { CaseStatus } from "../models/types";

type CaseFilter = "open" | "all" | CaseStatus;

export function CasesPage() {
  const navigate = useNavigate();
  const { data: cases = [] } = useGetCasesQuery();
  const [filter, setFilter] = useState<CaseFilter>("open");

  const visibleCases = useMemo(() => {
    if (filter === "all") {
      return cases;
    }
    if (filter === "open") {
      return cases.filter((item) => item.status !== "closed");
    }
    return cases.filter((item) => item.status === filter);
  }, [cases, filter]);

  const closedCount = cases.filter((item) => item.status === "closed").length;
  const completion =
    cases.length === 0 ? 0 : Math.round((closedCount / cases.length) * 100);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>案件工作台</Title>
          <Text c="dimmed" size="sm" mt={4}>
            在一个工作区内联动关系图谱、交易时间线、证据和结论版本。
          </Text>
        </div>
        <Button
          variant="light"
          leftSection={<FolderOpen size={16} />}
          onClick={() => navigate("/alerts")}
        >
          从告警创建关联
        </Button>
      </Group>

      <Paper withBorder p="md">
        <Group justify="space-between" align="center">
          <SegmentedControl
            value={filter}
            onChange={(value) => setFilter(value as CaseFilter)}
            data={[
              { label: "活跃案件", value: "open" },
              { label: "调查中", value: "investigating" },
              { label: "待复核", value: "pending_review" },
              { label: "待补证", value: "supplement" },
              { label: "全部", value: "all" },
            ]}
          />
          <Group w={260}>
            <div style={{ flex: 1 }}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  关闭完成度
                </Text>
                <Text size="xs" fw={600}>
                  {completion}%
                </Text>
              </Group>
              <Progress value={completion} color="teal" mt={6} />
            </div>
          </Group>
        </Group>
      </Paper>

      <Paper withBorder>
        <Table.ScrollContainer minWidth={940}>
          <Table highlightOnHover verticalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>案件编号</Table.Th>
                <Table.Th>案件摘要</Table.Th>
                <Table.Th>风险</Table.Th>
                <Table.Th>状态</Table.Th>
                <Table.Th>告警数</Table.Th>
                <Table.Th>负责人</Table.Th>
                <Table.Th>更新时间</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visibleCases.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>
                    <Text size="sm" ff="monospace" fw={600}>
                      {item.id}
                    </Text>
                  </Table.Td>
                  <Table.Td maw={360}>
                    <Text size="sm" fw={600}>
                      {item.title}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={2} mt={3}>
                      {item.summary}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <RiskBadge value={item.riskLevel} />
                  </Table.Td>
                  <Table.Td>
                    <CaseStatusBadge value={item.status} />
                  </Table.Td>
                  <Table.Td>{item.alertIds.length}</Table.Td>
                  <Table.Td>{item.owner}</Table.Td>
                  <Table.Td>
                    <Text size="xs">
                      {new Date(item.updatedAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="light"
                      rightSection={<ArrowRight size={14} />}
                      onClick={() => navigate(`/cases/${item.id}`)}
                    >
                      {caseStatusLabel(item.status)}
                    </Button>
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
