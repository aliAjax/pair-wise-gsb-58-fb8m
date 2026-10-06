import {
  Badge,
  Box,
  Group,
  ScrollArea,
  Text,
  Timeline,
} from "@mantine/core";
import { CircleDollarSign, FileClock, Link2, UserCheck } from "lucide-react";
import type {
  Alert,
  Evidence,
  InvestigationEdge,
} from "../../models/types";

interface TimelineEvent {
  id: string;
  at: string;
  title: string;
  detail: string;
  source: "transaction" | "evidence" | "alert" | "review";
  resourceId: string;
}

interface TransactionTimelineProps {
  alerts: Alert[];
  edges: InvestigationEdge[];
  evidence: Evidence[];
  focusedId?: string;
  onFocus: (event?: TimelineEvent) => void;
}

export function TransactionTimeline({
  alerts,
  edges,
  evidence,
  focusedId,
  onFocus,
}: TransactionTimelineProps) {
  const events: TimelineEvent[] = [
    ...alerts.map((item) => ({
      id: item.id,
      at: item.detectedAt,
      title: item.title,
      detail: `${item.account} / ${item.channel} / 风险分 ${item.score}`,
      source: "alert" as const,
      resourceId: item.id,
    })),
    ...edges.map((item) => ({
      id: item.id,
      at: item.occurredAt,
      title: item.label,
      detail: item.explanation,
      source: "transaction" as const,
      resourceId: item.id,
    })),
    ...evidence.map((item) => ({
      id: item.id,
      at: item.occurredAt,
      title: item.title,
      detail: `${item.source} / 版本 V${item.version}`,
      source: "evidence" as const,
      resourceId: item.id,
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const iconMap = {
    transaction: CircleDollarSign,
    evidence: FileClock,
    alert: Link2,
    review: UserCheck,
  };

  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars>
      <Timeline bulletSize={30} lineWidth={2} className="case-timeline">
        {events.map((event) => {
          const active = event.id === focusedId;
          const Icon = iconMap[event.source];
          return (
            <Timeline.Item
              key={`${event.source}-${event.id}`}
              bullet={<Icon size={15} />}
              className={active ? "timeline-item-active" : ""}
            >
              <Box
                role="button"
                tabIndex={0}
                onClick={() => onFocus(active ? undefined : event)}
                onKeyDown={(keyboardEvent) => {
                  if (
                    keyboardEvent.key === "Enter" ||
                    keyboardEvent.key === " "
                  ) {
                    onFocus(active ? undefined : event);
                  }
                }}
                className="timeline-event"
              >
                <Group justify="space-between" gap="xs">
                  <Text size="sm" fw={600}>
                    {event.title}
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    {event.source === "transaction"
                      ? "交易"
                      : event.source === "evidence"
                        ? "证据"
                        : "告警"}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed" mt={4} lineClamp={2}>
                  {event.detail}
                </Text>
                <Text size="xs" c="dimmed" mt={4}>
                  {new Date(event.at).toLocaleString("zh-CN", {
                    hour12: false,
                  })}
                </Text>
              </Box>
            </Timeline.Item>
          );
        })}
      </Timeline>
    </ScrollArea>
  );
}

export type { TimelineEvent };
