import {
  AppShell as MantineAppShell,
  Box,
  Group,
  NavLink,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  AlertTriangle,
  FileSearch,
  FolderSearch2,
  LayoutDashboard,
  ShieldCheck,
} from "lucide-react";
import { NavLink as RouterNavLink, Outlet, useLocation } from "react-router-dom";

const navigation = [
  {
    to: "/",
    label: "调查概览",
    description: "风险与待办",
    icon: LayoutDashboard,
  },
  {
    to: "/alerts",
    label: "告警中心",
    description: "筛选与分诊",
    icon: AlertTriangle,
  },
  {
    to: "/cases",
    label: "案件工作台",
    description: "图谱与证据",
    icon: FolderSearch2,
  },
  {
    to: "/audit",
    label: "审计与报告",
    description: "追溯与导出",
    icon: FileSearch,
  },
];

export function AppShell() {
  const location = useLocation();

  return (
    <MantineAppShell
      header={{ height: 64 }}
      navbar={{ width: 248, breakpoint: "sm" }}
      padding="lg"
      className="app-shell"
    >
      <MantineAppShell.Header className="top-bar">
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <ThemeIcon size={38} radius="sm" color="teal">
              <ShieldCheck size={22} />
            </ThemeIcon>
            <Box>
              <Title order={4}>银行反欺诈案件调查平台</Title>
              <Text size="xs" c="dimmed">
                关系分析、证据核验与复核留痕
              </Text>
            </Box>
          </Group>
          <Group gap="xs" visibleFrom="md">
            <Text size="sm" c="dimmed">
              当前角色
            </Text>
            <Text size="sm" fw={600}>
              案件调查员 / 林澜
            </Text>
          </Group>
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar p="sm">
        <Stack gap={4}>
          {navigation.map((item) => {
            const Icon = item.icon;
            const active =
              item.to === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                component={RouterNavLink}
                to={item.to}
                active={active}
                label={item.label}
                description={item.description}
                leftSection={<Icon size={19} />}
                className="main-nav-link"
              />
            );
          })}
        </Stack>
      </MantineAppShell.Navbar>

      <MantineAppShell.Main className="main-surface">
        <Outlet />
      </MantineAppShell.Main>
    </MantineAppShell>
  );
}
