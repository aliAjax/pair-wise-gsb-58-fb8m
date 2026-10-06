import {
  Badge,
  Box,
  Group,
  Paper,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { CreditCard, Globe2, Landmark, Smartphone } from "lucide-react";
import { useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import type {
  InvestigationEdge,
  InvestigationNode,
  NodeKind,
} from "../../models/types";
import { RiskBadge } from "../../components/Badges";

interface GraphNodeData {
  label: string;
  kind: NodeKind;
  riskLevel: InvestigationNode["data"]["riskLevel"];
  note: string;
  evidenceStrength: InvestigationNode["data"]["evidenceStrength"];
}

const nodeMeta: Record<
  NodeKind,
  { icon: typeof CreditCard; label: string; color: string }
> = {
  account: { icon: Landmark, label: "账户", color: "#1971c2" },
  device: { icon: Smartphone, label: "设备", color: "#0b7285" },
  ip: { icon: Globe2, label: "IP", color: "#5f3dc4" },
  merchant: { icon: CreditCard, label: "商户", color: "#c92a2a" },
};

function InvestigationNodeCard({
  data,
  selected,
}: NodeProps<GraphNodeData>) {
  const meta = nodeMeta[data.kind];
  const Icon = meta.icon;
  return (
    <Paper
      p="sm"
      withBorder
      className={`graph-node ${selected ? "graph-node-selected" : ""}`}
      style={{ borderTop: `4px solid ${meta.color}` }}
    >
      <Handle type="target" position={Position.Top} />
      <Group gap="xs" wrap="nowrap">
        <ThemeIcon size={30} variant="light" color="gray">
          <Icon size={16} />
        </ThemeIcon>
        <Box>
          <Text size="xs" c="dimmed">
            {meta.label}
          </Text>
          <Text size="sm" fw={700}>
            {data.label}
          </Text>
        </Box>
      </Group>
      <Group gap={6} mt="xs">
        <RiskBadge value={data.riskLevel} />
      </Group>
      <Handle type="source" position={Position.Bottom} />
    </Paper>
  );
}

const nodeTypes = { investigation: InvestigationNodeCard };

interface InvestigationGraphProps {
  nodes: InvestigationNode[];
  edges: InvestigationEdge[];
  selectedNodeId?: string;
  focusedTimelineId?: string;
  onSelectNode: (nodeId?: string) => void;
  onNodePositionChange: (
    nodeId: string,
    position: { x: number; y: number },
  ) => void;
}

export function InvestigationGraph({
  nodes,
  edges,
  selectedNodeId,
  focusedTimelineId,
  onSelectNode,
  onNodePositionChange,
}: InvestigationGraphProps) {
  const mappedNodes = useMemo<Node<GraphNodeData>[]>(
    () =>
      nodes.map((item) => ({
        id: item.id,
        type: "investigation",
        position: item.position,
        selected: item.id === selectedNodeId,
        data: {
          label: item.data.label,
          kind: item.data.kind,
          riskLevel: item.data.riskLevel,
          note: item.data.note,
          evidenceStrength: item.data.evidenceStrength,
        },
      })),
    [nodes, selectedNodeId],
  );

  const mappedEdges = useMemo<Edge[]>(
    () =>
      edges.map((item) => {
        const highlighted = focusedTimelineId === item.id;
        const isWeak = item.kind === "shared_ip";
        return {
          id: item.id,
          source: item.source,
          target: item.target,
          label: item.label,
          animated: highlighted,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: {
            stroke: highlighted ? "#e8590c" : isWeak ? "#868e96" : "#0b7285",
            strokeWidth: highlighted ? 3 : 1.7,
          },
          labelStyle: {
            fill: highlighted ? "#d9480f" : "#495057",
            fontWeight: highlighted ? 700 : 500,
          },
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
          data: item,
        };
      }),
    [edges, focusedTimelineId],
  );

  const [flowNodes, setFlowNodes, onNodesChange] =
    useNodesState<GraphNodeData>(mappedNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(mappedEdges);

  useEffect(() => {
    setFlowNodes(mappedNodes);
  }, [mappedNodes, setFlowNodes]);

  useEffect(() => {
    setFlowEdges(mappedEdges);
  }, [mappedEdges, setFlowEdges]);

  return (
    <Box className="graph-canvas">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_event, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(undefined)}
        onNodeDragStop={(_event, node) =>
          onNodePositionChange(node.id, node.position)
        }
        fitView
        minZoom={0.35}
        maxZoom={1.8}
        attributionPosition="bottom-left"
      >
        <Background color="#c9d4dc" gap={22} size={1} />
        <Controls position="bottom-right" />
      </ReactFlow>
      <Paper className="graph-legend" p="xs" withBorder>
        <Group gap="sm">
          <Badge variant="dot" color="teal">
            实线：交易或共享关系
          </Badge>
          <Badge variant="dot" color="gray">
            灰线：弱关联
          </Badge>
          <Badge variant="dot" color="orange">
            高亮：时间轴选中
          </Badge>
        </Group>
      </Paper>
    </Box>
  );
}
