import {
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Download, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useGetAuditLogsQuery, useGetCasesQuery, useResetMockDataMutation } from "../services/api";

const download = (
  filename: string,
  content: string,
  type = "text/plain;charset=utf-8",
) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const escapeCsv = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

export function AuditPage() {
  const { data: logs = [] } = useGetAuditLogsQuery();
  const { data: cases = [] } = useGetCasesQuery();
  const [resetMockData, { isLoading: isResetting }] =
    useResetMockDataMutation();
  const [keyword, setKeyword] = useState("");
  const [caseId, setCaseId] = useState("all");

  const filteredLogs = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return logs.filter((item) => {
      const matchesCase = caseId === "all" || item.caseId === caseId;
      const matchesKeyword =
        !normalized ||
        [item.actor, item.action, item.detail, item.caseId ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      return matchesCase && matchesKeyword;
    });
  }, [caseId, keyword, logs]);

  const handleReset = async () => {
    await resetMockData().unwrap();
    notifications.show({
      color: "teal",
      title: "演示数据已重置",
      message: "本地 localStorage 中的案件、证据与审计记录已恢复为初始数据。",
    });
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>审计与报告</Title>
          <Text c="dimmed" size="sm" mt={4}>
            所有关联、证据、结论、复核和状态流转均保留来源与时间。
          </Text>
        </div>
        <Group>
          <Button
            variant="default"
            leftSection={<RotateCcw size={16} />}
            loading={isResetting}
            onClick={handleReset}
          >
            重置演示数据
          </Button>
          <Button
            variant="light"
            leftSection={<Download size={16} />}
            onClick={() =>
              download(
                "fraud-case-audit.json",
                JSON.stringify(filteredLogs, null, 2),
                "application/json;charset=utf-8",
              )
            }
          >
            导出 JSON
          </Button>
          <Button
            leftSection={<Download size={16} />}
            onClick={() =>
              download(
                "fraud-case-audit.csv",
                [
                  ["时间", "案件", "操作人", "动作", "详情"],
                  ...filteredLogs.map((item) => [
                    item.at,
                    item.caseId ?? "",
                    item.actor,
                    item.action,
                    item.detail,
                  ]),
                ]
                  .map((row) => row.map(escapeCsv).join(","))
                  .join("\n"),
                "text/csv;charset=utf-8",
              )
            }
          >
            导出 CSV
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Paper withBorder p="md">
          <Text size="sm" c="dimmed">
            审计事件
          </Text>
          <Title order={3} mt={5}>
            {logs.length}
          </Title>
        </Paper>
        <Paper withBorder p="md">
          <Text size="sm" c="dimmed">
            覆盖案件
          </Text>
          <Title order={3} mt={5}>
            {new Set(logs.map((item) => item.caseId).filter(Boolean)).size}
          </Title>
        </Paper>
        <Paper withBorder p="md">
          <Text size="sm" c="dimmed">
            不可修改字段
          </Text>
          <Title order={3} mt={5}>
            时间 / 来源 / 操作人
          </Title>
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="md">
        <Group grow align="flex-end">
          <TextInput
            label="关键词"
            placeholder="操作人、动作、详情或案件编号"
            leftSection={<Search size={16} />}
            value={keyword}
            onChange={(event) => setKeyword(event.currentTarget.value)}
          />
          <Select
            label="案件"
            value={caseId}
            onChange={(value) => setCaseId(value ?? "all")}
            data={[
              { value: "all", label: "全部案件" },
              ...cases.map((item) => ({
                value: item.id,
                label: `${item.id} ${item.title}`,
              })),
            ]}
          />
        </Group>
      </Paper>

      <Paper withBorder>
        <Table.ScrollContainer minWidth={960}>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>时间</Table.Th>
                <Table.Th>案件</Table.Th>
                <Table.Th>操作人</Table.Th>
                <Table.Th>动作</Table.Th>
                <Table.Th>详情</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredLogs.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {new Date(item.at).toLocaleString("zh-CN", {
                        hour12: false,
                      })}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {item.caseId ?? "系统级"}
                    </Text>
                  </Table.Td>
                  <Table.Td>{item.actor}</Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {item.action}
                    </Text>
                  </Table.Td>
                  <Table.Td maw={520}>
                    <Text size="sm">{item.detail}</Text>
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
