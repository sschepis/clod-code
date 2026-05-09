import React, { useRef, useCallback } from 'react';
import {
  MessageSquare, Settings, Zap, Globe, Layout, Code2, Terminal,
  GitBranch, Search, Bot, Layers, Cpu, ArrowRight, Workflow,
  FileCode, Plug, ChevronDown, BookOpen, Sparkles, Network,
  BrainCircuit, Rocket, Shield, DollarSign, MousePointerClick,
} from 'lucide-react';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = (() => {
  if (typeof acquireVsCodeApi === 'function') return acquireVsCodeApi();
  return { postMessage: (m: unknown) => console.log('[mock]', m) };
})();

function cmd(command: string) {
  vscode.postMessage({ type: 'command', command });
}

/* ── Shared styling constants ─────────────────────────────────────── */

const cardStyle: React.CSSProperties = {
  background: 'var(--vscode-editor-background)',
  border: '1px solid var(--vscode-widget-border, rgba(255,255,255,.08))',
  borderRadius: 12,
  padding: '28px 32px',
  marginBottom: 12,
};

const sectionStyle: React.CSSProperties = {
  maxWidth: 900,
  margin: '0 auto',
  padding: '48px 24px 0',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 12px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: 'uppercase' as const,
  background: 'rgba(99,102,241,.15)',
  color: 'rgb(129,140,248)',
};

const headingStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  margin: '0 0 8px',
  color: 'var(--vscode-foreground)',
  letterSpacing: -0.5,
};

const subheadStyle: React.CSSProperties = {
  fontSize: 15,
  color: 'var(--vscode-descriptionForeground)',
  margin: '0 0 28px',
  lineHeight: 1.6,
};

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 24px',
  borderRadius: 8,
  border: 'none',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  background: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
  transition: 'opacity .15s',
};

const btnSecondary: React.CSSProperties = {
  ...btnPrimary,
  background: 'var(--vscode-button-secondaryBackground)',
  color: 'var(--vscode-button-secondaryForeground)',
};

const codeBlock: React.CSSProperties = {
  background: 'var(--vscode-textCodeBlock-background, rgba(255,255,255,.04))',
  border: '1px solid var(--vscode-widget-border, rgba(255,255,255,.06))',
  borderRadius: 8,
  padding: '16px 20px',
  fontSize: 13,
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  lineHeight: 1.7,
  overflow: 'auto',
  color: 'var(--vscode-editor-foreground)',
  whiteSpace: 'pre' as const,
};

const gradientText: React.CSSProperties = {
  background: 'linear-gradient(135deg, rgb(99,102,241), rgb(168,85,247), rgb(236,72,153))',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
};

/* ── Small reusable bits ──────────────────────────────────────────── */

function SectionBadge({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div style={{ ...badgeStyle, marginBottom: 16 }}>
      <Icon size={13} /> {label}
    </div>
  );
}

function FeatureCard({ icon: Icon, title, children, accent }: {
  icon: React.ElementType; title: string; children: React.ReactNode; accent?: string;
}) {
  const accentColor = accent || 'rgb(99,102,241)';
  return (
    <div style={{
      ...cardStyle,
      display: 'flex',
      gap: 20,
      alignItems: 'flex-start',
    }}>
      <div style={{
        flexShrink: 0,
        width: 44,
        height: 44,
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `${accentColor}22`,
        color: accentColor,
      }}>
        <Icon size={22} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: 'var(--vscode-foreground)' }}>{title}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--vscode-descriptionForeground)' }}>{children}</div>
      </div>
    </div>
  );
}

function Step({ n, title, children, action }: {
  n: number; title: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 28 }}>
      <div style={{
        flexShrink: 0,
        width: 36,
        height: 36,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 15,
        ...gradientText,
        border: '2px solid rgba(99,102,241,.3)',
        WebkitTextFillColor: 'unset',
        background: 'transparent',
        color: 'rgb(129,140,248)',
      }}>{n}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, color: 'var(--vscode-foreground)' }}>{title}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--vscode-descriptionForeground)', marginBottom: action ? 12 : 0 }}>{children}</div>
        {action}
      </div>
    </div>
  );
}

function ToolGroup({ icon: Icon, label, items, accent }: {
  icon: React.ElementType; label: string; items: string[]; accent: string;
}) {
  return (
    <div style={{
      ...cardStyle,
      padding: '20px 24px',
      marginBottom: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Icon size={18} style={{ color: accent }} />
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--vscode-foreground)' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map(item => (
          <span key={item} style={{
            fontSize: 11.5,
            padding: '3px 10px',
            borderRadius: 6,
            background: 'var(--vscode-badge-background, rgba(255,255,255,.06))',
            color: 'var(--vscode-badge-foreground, var(--vscode-descriptionForeground))',
          }}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{
    height: 1,
    background: 'linear-gradient(90deg, transparent, var(--vscode-widget-border, rgba(255,255,255,.08)), transparent)',
    margin: '16px 0 0',
  }} />;
}

/* ── Main Component ───────────────────────────────────────────────── */

export default function WelcomeApp() {
  const quickStartRef = useRef<HTMLDivElement>(null);

  const scrollToStart = useCallback(() => {
    quickStartRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
      color: 'var(--vscode-foreground)',
      fontFamily: 'var(--vscode-font-family, system-ui, -apple-system, sans-serif)',
      paddingBottom: 80,
    }}>
      {/* ── Hero ────────────────────────────────────────────────── */}
      <div style={{
        textAlign: 'center',
        padding: '72px 24px 56px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99,102,241,.12), transparent)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 72,
            height: 72,
            borderRadius: 18,
            background: 'linear-gradient(135deg, rgba(99,102,241,.15), rgba(168,85,247,.15))',
            marginBottom: 24,
            border: '1px solid rgba(99,102,241,.2)',
          }}>
            <Sparkles size={36} style={{ color: 'rgb(129,140,248)' }} />
          </div>

          <h1 style={{
            fontSize: 42,
            fontWeight: 800,
            margin: '0 0 12px',
            letterSpacing: -1,
            ...gradientText,
          }}>
            Oboto VS
          </h1>

          <p style={{
            fontSize: 17,
            color: 'var(--vscode-descriptionForeground)',
            maxWidth: 600,
            margin: '0 auto 8px',
            lineHeight: 1.6,
          }}>
            Build AI-powered applications on top of the Visual Studio Code platform.
          </p>
          <p style={{
            fontSize: 14,
            color: 'var(--vscode-descriptionForeground)',
            maxWidth: 520,
            margin: '0 auto 32px',
            lineHeight: 1.6,
            opacity: 0.7,
          }}>
            Embed UIs, create API endpoints, and orchestrate complex multi-agent
            workflows with natural language commands and a powerful toolkit of
            pre-built actions.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button style={btnPrimary} onClick={scrollToStart}>
              Get Started <ChevronDown size={16} />
            </button>
            <button style={btnSecondary} onClick={() => cmd('obotovs.focusChat')}>
              <MessageSquare size={16} /> Open Chat
            </button>
          </div>
        </div>
      </div>

      <Divider />

      {/* ── Quick Start ─────────────────────────────────────────── */}
      <div ref={quickStartRef} style={sectionStyle}>
        <SectionBadge icon={Rocket} label="Quick Start" />
        <h2 style={headingStyle}>Up and running in 60 seconds</h2>
        <p style={subheadStyle}>
          Three steps to your first AI-powered conversation.
        </p>

        <div style={cardStyle}>
          <Step n={1} title="Open the Sidebar">
            Click the Oboto icon in the Activity Bar, or press{' '}
            <kbd style={{ padding: '2px 6px', borderRadius: 4, fontSize: 12, border: '1px solid var(--vscode-widget-border, rgba(255,255,255,.15))', background: 'rgba(255,255,255,.04)' }}>
              Cmd+Shift+L
            </kbd>
          </Step>
          <Step n={2} title="Configure a Provider"
            action={
              <button style={btnSecondary} onClick={() => cmd('obotovs.openSettings')}>
                <Settings size={14} /> Open Settings
              </button>
            }
          >
            Add an API key for Anthropic, OpenAI, or Google — or connect a local model
            via Ollama or LM Studio. Oboto supports 10+ providers out of the box.
          </Step>
          <Step n={3} title="Start Building">
            Ask the agent to do anything — edit files, run commands, create UIs,
            stand up API endpoints. It has access to 100+ tools and can spawn
            background agents for parallel work.
          </Step>
        </div>
      </div>

      <Divider />

      {/* ── Surfaces ────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionBadge icon={Layout} label="Surfaces" />
        <h2 style={headingStyle}>Interactive UIs inside VS Code</h2>
        <p style={subheadStyle}>
          Surfaces are HTML panels that live inside your editor. Build dashboards,
          forms, data visualizations — anything you can put in a browser. They
          auto-reload on save and communicate with agents through channels.
        </p>

        <div style={cardStyle}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
              {[
                { icon: Zap, label: 'Hot reload', desc: 'Changes appear instantly' },
                { icon: MessageSquare, label: 'Agent messaging', desc: 'Bidirectional channels' },
                { icon: Code2, label: 'Any framework', desc: 'React, Vue, Svelte, vanilla' },
              ].map(f => (
                <div key={f.label} style={{ flex: '1 1 200px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <f.icon size={16} style={{ color: 'rgb(52,211,153)', marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{f.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground)' }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vscode-descriptionForeground)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Try it — tell the agent:
          </div>
          <div style={codeBlock}>
{`"Create a surface that shows a real-time dashboard
 of my project's file structure with a search bar."`}
          </div>
          <div style={{ marginTop: 16, fontSize: 13, color: 'var(--vscode-descriptionForeground)' }}>
            The agent writes the HTML to <code style={{ fontSize: 12, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,.06)' }}>.obotovs/surfaces/</code>,
            opens it as a webview panel, and wires up the data — all in one conversation turn.
          </div>
        </div>
      </div>

      <Divider />

      {/* ── Routes ──────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionBadge icon={Globe} label="Routes" />
        <h2 style={headingStyle}>Local API endpoints in seconds</h2>
        <p style={subheadStyle}>
          Routes are Express-compatible endpoints that run on a local server inside
          VS Code. Auto-assigned ports, hot reload, CORS enabled.
        </p>

        <div style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vscode-descriptionForeground)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Example prompt:
          </div>
          <div style={codeBlock}>
{`"Create a POST route at /api/summarize that accepts
 a body of text and returns a one-paragraph summary
 using the configured LLM."`}
          </div>
          <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {[
              { icon: Zap, label: 'Hot reload on save' },
              { icon: Shield, label: 'CORS enabled' },
              { icon: Plug, label: 'Auto port allocation' },
            ].map(f => (
              <div key={f.label} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--vscode-descriptionForeground)' }}>
                <f.icon size={14} style={{ color: 'rgb(251,191,36)' }} /> {f.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Divider />

      {/* ── Multi-Agent ─────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionBadge icon={Workflow} label="Agents" />
        <h2 style={headingStyle}>Multi-agent orchestration</h2>
        <p style={subheadStyle}>
          Run a foreground agent in your chat plus up to 50 background agents
          working in parallel. Agents can spawn sub-agents, message each other,
          and coordinate across VS Code windows.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
          <FeatureCard icon={Layers} title="Background Agents" accent="rgb(99,102,241)">
            Spawn agents for parallel tasks — code review, testing, refactoring —
            all running concurrently while you keep chatting.
          </FeatureCard>
          <FeatureCard icon={DollarSign} title="Budget Control" accent="rgb(52,211,153)">
            Set per-agent USD ceilings and timeouts. The chaperone system pauses for
            human review after configurable iterations.
          </FeatureCard>
          <FeatureCard icon={BrainCircuit} title="Recursive Spawning" accent="rgb(168,85,247)">
            Agents can spawn sub-agents up to a configurable depth, breaking complex
            tasks into managed subtasks automatically.
          </FeatureCard>
          <FeatureCard icon={Network} title="Peer Network" accent="rgb(236,72,153)">
            Multiple VS Code windows discover each other and can dispatch tasks
            across windows with user approval.
          </FeatureCard>
        </div>

        <div style={{ ...cardStyle, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vscode-descriptionForeground)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Try it:
          </div>
          <div style={codeBlock}>
{`"Refactor the auth module, run the test suite, and
 update the changelog — do all three in parallel."`}
          </div>
        </div>
      </div>

      <Divider />

      {/* ── Skills ──────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionBadge icon={BookOpen} label="Skills" />
        <h2 style={headingStyle}>Teach the agent new tricks</h2>
        <p style={subheadStyle}>
          Skills are markdown files that extend the agent's capabilities. Drop a
          file into <code style={{ fontSize: 13, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,.06)' }}>.obotovs/skills/</code> and
          it's automatically available. Promote skills to global scope to share
          them across all your projects.
        </p>

        <div style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vscode-descriptionForeground)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Example skill file:
          </div>
          <div style={codeBlock}>
{`---
name: pr-review
description: Review pull requests thoroughly
when: user mentions "PR" or "pull request"
---

# PR Review Checklist

1. Check for breaking changes
2. Verify test coverage
3. Review error handling
4. Check for security issues
5. Validate naming conventions`}
          </div>
          <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {[
              { icon: FileCode, label: 'Plain markdown' },
              { icon: Zap, label: 'Auto-reload on change' },
              { icon: Globe, label: 'Promote to global scope' },
            ].map(f => (
              <div key={f.label} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--vscode-descriptionForeground)' }}>
                <f.icon size={14} style={{ color: 'rgb(168,85,247)' }} /> {f.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Divider />

      {/* ── Tools ───────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionBadge icon={Zap} label="Toolkit" />
        <h2 style={headingStyle}>100+ built-in tools</h2>
        <p style={subheadStyle}>
          No configuration needed. The agent has full access to your editor, file
          system, git, terminal, and the web — all through a unified tool tree.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <ToolGroup icon={FileCode} label="File & Git" accent="rgb(52,211,153)"
            items={['read', 'write', 'edit', 'status', 'diff', 'log', 'commit', 'branch', 'stash']} />
          <ToolGroup icon={Code2} label="Code Intelligence" accent="rgb(99,102,241)"
            items={['definition', 'references', 'symbols', 'rename', 'call hierarchy', 'dataflow', 'impact analysis']} />
          <ToolGroup icon={Search} label="Search" accent="rgb(251,191,36)"
            items={['glob', 'grep', 'workspace symbols']} />
          <ToolGroup icon={Terminal} label="Shell & Execution" accent="rgb(239,68,68)"
            items={['run', 'background', 'code eval']} />
          <ToolGroup icon={Globe} label="Web" accent="rgb(59,130,246)"
            items={['search', 'fetch', 'browse', 'screenshot', 'click', 'type', 'eval']} />
          <ToolGroup icon={Bot} label="Agent Orchestration" accent="rgb(168,85,247)"
            items={['spawn', 'query', 'message', 'cancel', 'batch', 'collect']} />
          <ToolGroup icon={Layout} label="Surfaces & Routes" accent="rgb(236,72,153)"
            items={['create', 'update', 'open', 'screenshot', 'push', 'broadcast']} />
          <ToolGroup icon={MousePointerClick} label="UI Automation" accent="rgb(234,179,8)"
            items={['screenshot', 'cursor', 'move', 'click', 'drag', 'type', 'keypress']} />
        </div>
      </div>

      <Divider />

      {/* ── Multi-LLM ───────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionBadge icon={Cpu} label="Providers" />
        <h2 style={headingStyle}>Any model, any provider</h2>
        <p style={subheadStyle}>
          Connect cloud APIs and local models side by side. Route different
          task types to different models for optimal cost and performance.
        </p>

        <div style={cardStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
            {[
              'Anthropic', 'OpenAI', 'Google Gemini', 'Azure OpenAI',
              'Vertex AI', 'DeepSeek', 'OpenRouter', 'Ollama', 'LM Studio', 'VS Code LM',
            ].map(name => (
              <div key={name} style={{
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                textAlign: 'center',
                background: 'var(--vscode-input-background, rgba(255,255,255,.04))',
                border: '1px solid var(--vscode-widget-border, rgba(255,255,255,.06))',
                color: 'var(--vscode-foreground)',
              }}>{name}</div>
            ))}
          </div>

          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--vscode-foreground)' }}>
            Role-based routing
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {[
              { role: 'Triage', desc: 'Fast classification', color: 'rgb(52,211,153)' },
              { role: 'Executor', desc: 'Main task work', color: 'rgb(99,102,241)' },
              { role: 'Coder', desc: 'Code generation', color: 'rgb(59,130,246)' },
              { role: 'Planner', desc: 'Architecture', color: 'rgb(168,85,247)' },
              { role: 'Summarizer', desc: 'Compaction', color: 'rgb(251,191,36)' },
            ].map(r => (
              <div key={r.role} style={{
                flex: '1 1 140px',
                padding: '10px 14px',
                borderRadius: 8,
                borderLeft: `3px solid ${r.color}`,
                background: 'var(--vscode-input-background, rgba(255,255,255,.04))',
              }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.role}</div>
                <div style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground)' }}>{r.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Divider />

      {/* ── Building Apps ───────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionBadge icon={Rocket} label="Build" />
        <h2 style={headingStyle}>Build apps with conversation</h2>
        <p style={subheadStyle}>
          Combine Surfaces, Routes, and Skills to build complete applications
          inside VS Code — all driven by natural language.
        </p>

        <div style={cardStyle}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Example: Build a feedback widget</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { step: '1', text: '"Create a route POST /api/feedback that stores entries in a JSON file"', color: 'rgb(251,191,36)' },
                { step: '2', text: '"Create a surface with a feedback form that posts to that endpoint"', color: 'rgb(236,72,153)' },
                { step: '3', text: '"Add a surface that shows all feedback entries as a sortable table"', color: 'rgb(99,102,241)' },
                { step: '4', text: '"Write a skill that describes our team\'s feedback triage process"', color: 'rgb(168,85,247)' },
              ].map(s => (
                <div key={s.step} style={{
                  display: 'flex',
                  gap: 14,
                  alignItems: 'flex-start',
                }}>
                  <div style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                    background: `${s.color}22`,
                    color: s.color,
                  }}>{s.step}</div>
                  <div style={{
                    ...codeBlock,
                    flex: 1,
                    margin: 0,
                    padding: '10px 16px',
                    fontSize: 13,
                  }}>{s.text}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--vscode-descriptionForeground)' }}>
            Each step takes one conversation turn. The agent creates the files, starts
            the server, opens the panels, and wires everything together.
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--vscode-foreground)' }}>
          What you can build:
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
          {[
            { icon: Layout, title: 'Dashboards & admin panels', desc: 'Live metrics, data visualizations, project overviews' },
            { icon: Globe, title: 'API prototypes', desc: 'Webhook receivers, proxy endpoints, mock servers' },
            { icon: GitBranch, title: 'Dev tools & automation', desc: 'Linters, analyzers, migration scripts, CI helpers' },
            { icon: Workflow, title: 'Multi-agent pipelines', desc: 'Code review, test orchestration, deployment automation' },
            { icon: BookOpen, title: 'Interactive tutorials', desc: 'Step-by-step guides with embedded UIs and live code' },
            { icon: Sparkles, title: 'AI-enhanced coding', desc: 'Custom skills that encode your team\'s patterns' },
          ].map(item => (
            <FeatureCard key={item.title} icon={item.icon} title={item.title} accent="rgb(99,102,241)">
              {item.desc}
            </FeatureCard>
          ))}
        </div>
      </div>

      <Divider />

      {/* ── Next Steps ──────────────────────────────────────────── */}
      <div style={{ ...sectionStyle, paddingBottom: 32 }}>
        <SectionBadge icon={ArrowRight} label="Next Steps" />
        <h2 style={headingStyle}>Ready to build?</h2>
        <p style={subheadStyle}>
          Jump in. The agent is ready to help.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button style={btnPrimary} onClick={() => cmd('obotovs.focusChat')}>
            <MessageSquare size={16} /> Open Chat
          </button>
          <button style={btnSecondary} onClick={() => cmd('obotovs.openSettings')}>
            <Settings size={16} /> Configure Providers
          </button>
          <button style={btnSecondary} onClick={() => cmd('obotovs.project.init')}>
            <Rocket size={16} /> Initialize Project
          </button>
        </div>

        <div style={{
          marginTop: 32,
          padding: '20px 24px',
          borderRadius: 10,
          border: '1px solid var(--vscode-widget-border, rgba(255,255,255,.08))',
          background: 'rgba(99,102,241,.04)',
          fontSize: 13,
          lineHeight: 1.7,
          color: 'var(--vscode-descriptionForeground)',
        }}>
          <strong style={{ color: 'var(--vscode-foreground)' }}>Tip:</strong> You can
          reopen this page anytime with the <strong>Oboto VS: Show Welcome</strong> command
          from the Command Palette (<kbd style={{
            padding: '2px 6px', borderRadius: 4, fontSize: 12,
            border: '1px solid var(--vscode-widget-border, rgba(255,255,255,.15))',
            background: 'rgba(255,255,255,.04)',
          }}>Cmd+Shift+P</kbd>).
        </div>
      </div>
    </div>
  );
}
