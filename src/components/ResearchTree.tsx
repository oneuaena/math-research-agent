import { useMemo } from 'react';
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import type { ResearchNode } from '../shared/types';
import { useAppStore } from '../store';
import { randomUUID } from '../utils';

type ResearchFlowNode = Node<{ record: ResearchNode }, 'research'>;

function ResearchNodeCard({ data, selected }: NodeProps<ResearchFlowNode>) {
  const node = data.record;
  return <div className={`flow-node status-${node.status} ${selected ? 'selected' : ''}`}>
    <Handle type="target" position={Position.Left} />
    <div className="flow-node-meta"><span>{node.kind}</span><i>{node.status}</i></div>
    <strong>{node.title}</strong>
    <Handle type="source" position={Position.Right} />
  </div>;
}
const nodeTypes = { research: ResearchNodeCard };

export function ResearchTree() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const { saveRecord, selectNode } = useAppStore();
  const nodes = useMemo<ResearchFlowNode[]>(() => snapshot.nodes.map((record) => ({ id: record.id, type: 'research', position: { x: record.x, y: record.y }, data: { record } })), [snapshot.nodes]);
  const edges = useMemo<Edge[]>(() => snapshot.graphEdges.length
    ? snapshot.graphEdges.map((edge) => ({ id: edge.id, source: edge.sourceId, target: edge.targetId, type: 'smoothstep', label: edge.kind, animated: edge.kind === 'REFUTES' }))
    : snapshot.nodes.filter((node) => node.parentId).map((node) => ({ id: `${node.parentId}-${node.id}`, source: node.parentId!, target: node.id, type: 'smoothstep', animated: node.status === 'in-progress' })), [snapshot.graphEdges, snapshot.nodes]);
  const addNode = () => {
    const now = new Date().toISOString();
    const root = snapshot.nodes.find((node) => node.parentId === null);
    const node: ResearchNode = { id: randomUUID(), projectId: snapshot.project.id, parentId: root?.id ?? null, kind: 'Open Problem', title: 'Open route', content: '', status: 'open', dependencies: root ? [root.id] : [], sources: [], tools: [], summary: '', x: 360, y: 120 + snapshot.nodes.length * 70, createdAt: now, updatedAt: now };
    void saveRecord('nodes', node);
  };
  return <div className="tree-view">
    <header className="view-toolbar"><div><h1>{snapshot.project.mode === 'stress-test' ? 'Attack tree' : 'Proof graph'}</h1><span>{snapshot.nodes.length} nodes · {snapshot.graphEdges.length} edges</span></div><button className="button secondary compact" onClick={addNode}><Plus size={15} />Node</button></header>
    <div className="flow-canvas"><ReactFlow<ResearchFlowNode>
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.35} maxZoom={1.5}
      onNodeClick={(_event, node) => selectNode(node.id)}
      onNodeDragStop={(_event, node) => { const record = snapshot.nodes.find((item) => item.id === node.id); if (record) void saveRecord('nodes', { ...record, x: node.position.x, y: node.position.y, updatedAt: new Date().toISOString() }); }}
      proOptions={{ hideAttribution: true }}>
      <Background gap={22} size={1} /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor="#647069" />
    </ReactFlow></div>
  </div>;
}
