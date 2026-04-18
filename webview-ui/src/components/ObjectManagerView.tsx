import React, { useMemo, useState } from 'react';
import {
  Bot, Loader2, Check, XCircle, AlertTriangle, X, Trash2,
  ChevronRight, ChevronDown, FolderTree, Layout, Route, Sparkles,
  Brain, MessageSquare, FolderOpen, Eye,
} from 'lucide-react';
import type {
  AgentSummary, ObjectSnapshot, SurfaceInfo, RouteInfo, SkillInfo,
  MemoryInfo, ConversationInfo, ObjectCategory, ObjectActionKind,
} from '../../../src/shared/message-types';
import { FOREGROUND_AGENT_ID } from '../../../src/shared/message-types';

interface ObjectManagerViewProps {
  objects: ObjectSnapshot;
  agents: AgentSummary[];
  focusedAgentId: string;
  onFocusAgent: (agentId: string) => void;
  onCancelAgent: (agentId: string) => void;
  onObjectAction: (
    category: ObjectCategory,
    action: ObjectActionKind,
    id: string,
    agentId?: string,
  ) => void;
}

export const ObjectManagerView: React.FC<ObjectManagerViewProps> = ({
  objects, agents, focusedAgentId, onFocusAgent, onCancelAgent, onObjectAction,
}) => {
  const background = agents.filter((a) => a.id !== FOREGROUND_AGENT_ID);

  return (
    <div className="flex flex-col h-full bg-[#121214] text-zinc-200 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 sticky top-0 bg-[#121214] z-10 border-b border-zinc-900">
        <h2 className="text-sm font-semibold tracking-wide flex items-center gap-2">
          <FolderTree size={16} className="text-indigo-400" />
          Object Manager
        </h2>
      </div>

      <div className="flex flex-col">
        <Section
          title="Surfaces"
          icon={<Layout size={14} className="text-sky-400" />}
          count={objects.surfaces.length}
        >
          {objects.surfaces.length === 0 ? (
            <Empty>No surfaces. Create `.clodcode/surfaces/&lt;name&gt;.html`.</Empty>
          ) : (
            objects.surfaces.map((s) => (
              <SurfaceRow key={s.name} surface={s} onAction={onObjectAction} />
            ))
          )}
        </Section>

        <Section
          title="Routes"
          icon={<Route size={14} className="text-emerald-400" />}
          count={objects.routes.length}
        >
          {objects.routes.length === 0 ? (
            <Empty>No routes. Create `.clodcode/routes/…/route.js`.</Empty>
          ) : (
            <RouteTree routes={objects.routes} onAction={onObjectAction} />
          )}
        </Section>

        <Section
          title="Skills"
          icon={<Sparkles size={14} className="text-amber-400" />}
          count={objects.skills.length}
        >
          {objects.skills.length === 0 ? (
            <Empty>No skills. Add `.clodcode/skills/&lt;name&gt;.md`.</Empty>
          ) : (
            <SkillTree skills={objects.skills} onAction={onObjectAction} />
          )}
        </Section>

        <Section
          title="Agents"
          icon={<Bot size={14} className="text-indigo-400" />}
          count={background.length}
        >
          {background.length === 0 ? (
            <Empty>No background agents. Spawn with @agentName in chat.</Empty>
          ) : (
            background.map((a) => (
              <AgentRow
                key={a.id}
                agent={a}
                focused={focusedAgentId === a.id}
                onFocus={onFocusAgent}
                onCancel={onCancelAgent}
              />
            ))
          )}
        </Section>

        <Section
          title="Memories"
          icon={<Brain size={14} className="text-fuchsia-400" />}
          count={objects.memories.length}
        >
          <MemoryGroups memories={objects.memories} agents={agents} onAction={onObjectAction} />
        </Section>

        <Section
          title="Conversations"
          icon={<MessageSquare size={14} className="text-teal-400" />}
          count={objects.conversations.length}
        >
          {objects.conversations.length === 0 ? (
            <Empty>No conversations yet.</Empty>
          ) : (
            objects.conversations.map((c) => (
              <ConversationRow key={c.id} conversation={c} onAction={onObjectAction} />
            ))
          )}
        </Section>
      </div>
    </div>
  );
};

// ── Shared ──────────────────────────────────────────────────────────

const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, count, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-zinc-900/50 transition-colors"
      >
        {open ? <ChevronDown size={12} className="text-zinc-500" /> : <ChevronRight size={12} className="text-zinc-500" />}
        {icon}
        <span className="text-xs font-semibold tracking-wide uppercase text-zinc-300">{title}</span>
        <span className="ml-auto text-[10px] font-mono text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-900">
          {count}
        </span>
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
};

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-8 py-3 text-[11px] text-zinc-600 italic">{children}</div>
);

const RowActions: React.FC<{
  onOpen?: () => void;
  onReveal?: () => void;
  onDelete?: () => void;
  deleteTitle?: string;
}> = ({ onOpen, onReveal, onDelete, deleteTitle = 'Delete' }) => (
  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
    {onOpen && (
      <button
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
        title="Open"
      >
        <FolderOpen size={12} />
      </button>
    )}
    {onReveal && (
      <button
        onClick={(e) => { e.stopPropagation(); onReveal(); }}
        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
        title="Reveal in Explorer"
      >
        <Eye size={12} />
      </button>
    )}
    {onDelete && (
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-red-400"
        title={deleteTitle}
      >
        <Trash2 size={12} />
      </button>
    )}
  </div>
);

const LeafRow: React.FC<{
  label: React.ReactNode;
  subtitle?: React.ReactNode;
  indent?: number;
  onClick?: () => void;
  actions?: React.ReactNode;
}> = ({ label, subtitle, indent = 1, onClick, actions }) => (
  <div
    onClick={onClick}
    className={`group flex items-center gap-2 pr-3 py-1 text-xs hover:bg-zinc-900/60 ${onClick ? 'cursor-pointer' : ''}`}
    style={{ paddingLeft: `${12 + indent * 16}px` }}
  >
    <div className="min-w-0 flex-1 truncate">
      <div className="text-zinc-300 truncate">{label}</div>
      {subtitle && <div className="text-[10px] text-zinc-600 truncate">{subtitle}</div>}
    </div>
    {actions}
  </div>
);

// ── Surface ─────────────────────────────────────────────────────────

const SurfaceRow: React.FC<{
  surface: SurfaceInfo;
  onAction: ObjectManagerViewProps['onObjectAction'];
}> = ({ surface, onAction }) => (
  <LeafRow
    label={surface.name}
    subtitle={surface.filePath}
    onClick={() => onAction('surface', 'open', surface.name)}
    actions={
      <RowActions
        onOpen={() => onAction('surface', 'open', surface.name)}
        onReveal={() => onAction('surface', 'reveal', surface.name)}
        onDelete={() => onAction('surface', 'delete', surface.name)}
      />
    }
  />
);

// ── Route tree ──────────────────────────────────────────────────────

interface RouteNode {
  name: string;
  children: Map<string, RouteNode>;
  route?: RouteInfo;
}

function buildRouteTree(routes: RouteInfo[]): RouteNode {
  const root: RouteNode = { name: '', children: new Map() };
  for (const r of routes) {
    let node = root;
    for (const seg of r.segments) {
      let child = node.children.get(seg);
      if (!child) {
        child = { name: seg, children: new Map() };
        node.children.set(seg, child);
      }
      node = child;
    }
    node.route = r;
  }
  return root;
}

const RouteTree: React.FC<{
  routes: RouteInfo[];
  onAction: ObjectManagerViewProps['onObjectAction'];
}> = ({ routes, onAction }) => {
  const tree = useMemo(() => buildRouteTree(routes), [routes]);
  return <>{[...tree.children.values()].map((n) => <RouteTreeNode key={n.name} node={n} indent={1} onAction={onAction} />)}</>;
};

const RouteTreeNode: React.FC<{
  node: RouteNode;
  indent: number;
  onAction: ObjectManagerViewProps['onObjectAction'];
}> = ({ node, indent, onAction }) => {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.size > 0;
  const hasRoute = !!node.route;

  if (!hasChildren && hasRoute) {
    const r = node.route!;
    return (
      <LeafRow
        label={<span className="font-mono">{node.name}</span>}
        subtitle={r.urlPath}
        indent={indent}
        onClick={() => onAction('route', 'open', r.urlPath)}
        actions={
          <RowActions
            onOpen={() => onAction('route', 'open', r.urlPath)}
            onReveal={() => onAction('route', 'reveal', r.urlPath)}
            onDelete={() => onAction('route', 'delete', r.urlPath)}
          />
        }
      />
    );
  }

  return (
    <>
      <div
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 pr-3 py-1 text-xs hover:bg-zinc-900/60 cursor-pointer"
        style={{ paddingLeft: `${12 + indent * 16}px` }}
      >
        {open ? <ChevronDown size={10} className="text-zinc-600" /> : <ChevronRight size={10} className="text-zinc-600" />}
        <span className="font-mono text-zinc-400">{node.name}/</span>
        {hasRoute && (
          <span className="ml-2 text-[10px] text-zinc-600">({node.route!.urlPath})</span>
        )}
      </div>
      {open && [...node.children.values()].map((c) => (
        <RouteTreeNode key={c.name} node={c} indent={indent + 1} onAction={onAction} />
      ))}
    </>
  );
};

// ── Skill tree ──────────────────────────────────────────────────────

const SkillTree: React.FC<{
  skills: SkillInfo[];
  onAction: ObjectManagerViewProps['onObjectAction'];
}> = ({ skills, onAction }) => {
  // Group by first namespace segment (slash-separated).
  const groups = useMemo(() => {
    const map = new Map<string, SkillInfo[]>();
    for (const s of skills) {
      const parts = s.name.split('/');
      const key = parts.length > 1 ? parts[0] : '__flat__';
      const bucket = map.get(key) ?? [];
      bucket.push(s);
      map.set(key, bucket);
    }
    return map;
  }, [skills]);

  return (
    <>
      {[...groups.entries()].map(([key, group]) => (
        <SkillGroup key={key} name={key} skills={group} onAction={onAction} />
      ))}
    </>
  );
};

const SkillGroup: React.FC<{
  name: string;
  skills: SkillInfo[];
  onAction: ObjectManagerViewProps['onObjectAction'];
}> = ({ name, skills, onAction }) => {
  const [open, setOpen] = useState(true);
  const flat = name === '__flat__';

  if (flat) {
    return (
      <>
        {skills.map((s) => <SkillRow key={s.name} skill={s} indent={1} onAction={onAction} />)}
      </>
    );
  }

  return (
    <>
      <div
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 pr-3 py-1 text-xs hover:bg-zinc-900/60 cursor-pointer"
        style={{ paddingLeft: '28px' }}
      >
        {open ? <ChevronDown size={10} className="text-zinc-600" /> : <ChevronRight size={10} className="text-zinc-600" />}
        <span className="font-mono text-zinc-400">{name}/</span>
      </div>
      {open && skills.map((s) => (
        <SkillRow key={s.name} skill={s} indent={2} onAction={onAction} stripPrefix={`${name}/`} />
      ))}
    </>
  );
};

const SkillRow: React.FC<{
  skill: SkillInfo;
  indent: number;
  stripPrefix?: string;
  onAction: ObjectManagerViewProps['onObjectAction'];
}> = ({ skill, indent, stripPrefix, onAction }) => {
  const label = stripPrefix && skill.name.startsWith(stripPrefix)
    ? skill.name.slice(stripPrefix.length)
    : skill.name;
  return (
    <LeafRow
      label={label}
      subtitle={skill.description}
      indent={indent}
      onClick={() => onAction('skill', 'open', skill.name)}
      actions={
        <RowActions
          onOpen={() => onAction('skill', 'open', skill.name)}
          onReveal={() => onAction('skill', 'reveal', skill.name)}
          onDelete={() => onAction('skill', 'delete', skill.name)}
        />
      }
    />
  );
};

// ── Agent ───────────────────────────────────────────────────────────

const AgentRow: React.FC<{
  agent: AgentSummary;
  focused: boolean;
  onFocus: (id: string) => void;
  onCancel: (id: string) => void;
}> = ({ agent, focused, onFocus, onCancel }) => {
  const StatusIcon = (() => {
    switch (agent.status) {
      case 'running':  return <Loader2 size={12} className="animate-spin text-amber-400" />;
      case 'complete': return <Check size={12} className="text-emerald-400" />;
      case 'error':    return <AlertTriangle size={12} className="text-red-400" />;
      case 'cancelled':return <XCircle size={12} className="text-zinc-500" />;
      case 'idle':
      default:         return <Bot size={12} className="text-zinc-500" />;
    }
  })();

  return (
    <div
      onClick={() => onFocus(agent.id)}
      className={`group flex items-center gap-2 pr-3 py-1 text-xs cursor-pointer ${
        focused ? 'bg-indigo-500/10' : 'hover:bg-zinc-900/60'
      }`}
      style={{ paddingLeft: '28px' }}
    >
      {StatusIcon}
      <div className="min-w-0 flex-1 truncate">
        <div className="text-zinc-300 truncate">{agent.label}</div>
        <div className="text-[10px] text-zinc-600 truncate">
          {agent.status} · ${agent.cost.totalCost.toFixed(4)}
        </div>
      </div>
      {agent.status === 'running' && (
        <button
          onClick={(e) => { e.stopPropagation(); onCancel(agent.id); }}
          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-800 text-zinc-400 hover:text-red-400"
          title="Cancel agent"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
};

// ── Memory ──────────────────────────────────────────────────────────

const MemoryGroups: React.FC<{
  memories: MemoryInfo[];
  agents: AgentSummary[];
  onAction: ObjectManagerViewProps['onObjectAction'];
}> = ({ memories, agents, onAction }) => {
  const global = memories.filter((m) => m.scope === 'global');
  const project = memories.filter((m) => m.scope === 'project');
  const conversation = memories.filter((m) => m.scope === 'conversation');

  const byAgent = new Map<string, MemoryInfo[]>();
  for (const m of conversation) {
    const key = m.agentId ?? FOREGROUND_AGENT_ID;
    const bucket = byAgent.get(key) ?? [];
    bucket.push(m);
    byAgent.set(key, bucket);
  }

  const agentLabel = (id: string) => {
    if (id === FOREGROUND_AGENT_ID) return 'Foreground';
    const a = agents.find((x) => x.id === id);
    return a?.label ?? id.slice(0, 12);
  };

  const hasAny = global.length + project.length + conversation.length > 0;
  if (!hasAny) {
    return <Empty>No memories yet. Use /remember or recall from chat.</Empty>;
  }

  return (
    <>
      <MemorySubgroup name="Global" items={global} onAction={onAction} />
      <MemorySubgroup name="Project" items={project} onAction={onAction} />
      {[...byAgent.entries()].map(([agentId, entries]) => (
        <MemorySubgroup
          key={agentId}
          name={`Conversation · ${agentLabel(agentId)}`}
          items={entries}
          agentId={agentId}
          onAction={onAction}
        />
      ))}
    </>
  );
};

const MemorySubgroup: React.FC<{
  name: string;
  items: MemoryInfo[];
  agentId?: string;
  onAction: ObjectManagerViewProps['onObjectAction'];
}> = ({ name, items, agentId, onAction }) => {
  const [open, setOpen] = useState(items.length > 0 && items.length <= 10);
  if (items.length === 0) return null;
  return (
    <>
      <div
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 pr-3 py-1 text-xs hover:bg-zinc-900/60 cursor-pointer"
        style={{ paddingLeft: '28px' }}
      >
        {open ? <ChevronDown size={10} className="text-zinc-600" /> : <ChevronRight size={10} className="text-zinc-600" />}
        <span className="text-zinc-400">{name}</span>
        <span className="ml-auto text-[10px] font-mono text-zinc-600">{items.length}</span>
      </div>
      {open && items.map((m) => (
        <LeafRow
          key={`${m.scope}:${m.id}`}
          label={m.title}
          subtitle={m.tags.length > 0 ? m.tags.join(', ') : undefined}
          indent={2}
          onClick={() => onAction('memory', 'open', m.id, agentId)}
          actions={
            <RowActions
              onOpen={m.scope !== 'conversation' ? () => onAction('memory', 'open', m.id, agentId) : undefined}
              onReveal={m.scope !== 'conversation' ? () => onAction('memory', 'reveal', m.id, agentId) : undefined}
              onDelete={() => onAction('memory', 'delete', m.id, agentId)}
            />
          }
        />
      ))}
    </>
  );
};

// ── Conversation ────────────────────────────────────────────────────

const ConversationRow: React.FC<{
  conversation: ConversationInfo;
  onAction: ObjectManagerViewProps['onObjectAction'];
}> = ({ conversation, onAction }) => (
  <LeafRow
    label={conversation.label}
    subtitle={conversation.filePath}
    onClick={() => onAction('conversation', 'open', conversation.id)}
    actions={
      <RowActions
        onOpen={() => onAction('conversation', 'open', conversation.id)}
        onReveal={() => onAction('conversation', 'reveal', conversation.id)}
        onDelete={conversation.kind === 'archive'
          ? () => onAction('conversation', 'delete', conversation.id)
          : undefined}
      />
    }
  />
);
