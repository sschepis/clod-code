import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { CodeBlock } from './CodeBlock';
import { JsVizBlock } from './JsVizBlock';
import { ActionBlock, TraceBlock } from './ActionBlock';
import type { ActionBlockProps, TraceBlockProps } from './ActionBlock';

interface MarkdownContentProps {
  content: string;
}

type Segment =
  | { type: 'markdown'; content: string }
  | { type: 'action'; props: ActionBlockProps }
  | { type: 'trace'; props: TraceBlockProps };

function parseActionBlocks(text: string): Segment[] {
  const segments: Segment[] = [];
  const markers: Array<{ start: number; end: number; segment: Segment }> = [];

  const actionRe = /\*\*\[Action:\s*(.+?)\]\*\*\s*(\S+)\s*\n((?:>\s*.+\n?)*)/g;
  let m: RegExpExecArray | null;
  while ((m = actionRe.exec(text)) !== null) {
    const label = m[1].trim();
    const emoji = m[2];
    const blockquote = m[3];
    const lines: Array<{ key: string; value: string }> = [];
    for (const line of blockquote.split('\n')) {
      const stripped = line.replace(/^>\s*/, '').trim();
      if (!stripped) continue;
      const kvMatch = stripped.match(/^\*\*(.+?):\*\*\s*(.+)$/);
      if (kvMatch) {
        lines.push({ key: kvMatch[1], value: kvMatch[2].trim() });
      } else {
        lines.push({ key: '', value: stripped });
      }
    }
    markers.push({
      start: m.index,
      end: m.index + m[0].length,
      segment: { type: 'action', props: { label, emoji, lines } },
    });
  }

  const traceRe = /\*\*\[Internal Validation Trace\](?::|\*\*:)\*?\s*\n((?:\*\s+\*.+?\*:.+\n?)*)/g;
  while ((m = traceRe.exec(text)) !== null) {
    const body = m[1];
    const items: Array<{ type: string; text: string }> = [];
    for (const line of body.split('\n')) {
      const im = line.match(/^\*\s+\*(.+?)\*:\s*(.+)$/);
      if (im) {
        items.push({ type: im[1].trim(), text: im[2].trim() });
      }
    }
    if (items.length > 0) {
      markers.push({
        start: m.index,
        end: m.index + m[0].length,
        segment: { type: 'trace', props: { items } },
      });
    }
  }

  if (markers.length === 0) {
    return [{ type: 'markdown', content: text }];
  }

  markers.sort((a, b) => a.start - b.start);

  let cursor = 0;
  for (const marker of markers) {
    if (marker.start > cursor) {
      const md = text.slice(cursor, marker.start).trim();
      if (md) segments.push({ type: 'markdown', content: md });
    }
    segments.push(marker.segment);
    cursor = marker.end;
  }
  if (cursor < text.length) {
    const md = text.slice(cursor).trim();
    if (md) segments.push({ type: 'markdown', content: md });
  }

  return segments;
}

/**
 * CommonMark requires a space between the `#` markers and the heading text
 * for ATX headings (`### Title`). Models sometimes emit `###Title` without
 * a space, which renders as a literal paragraph. Insert the missing space
 * so the intent comes through.
 */
function normalizeHeadings(text: string): string {
  return text.replace(/^(#{1,6})(?=\S)/gm, '$1 ');
}

/**
 * Strip raw tool-call text emitted by the agent framework. These look like
 * `[Tool call: command({...})]` and can span many lines when kwargs contain
 * large HTML payloads. The actual tool execution is already rendered as a
 * proper ToolBlock via tool_start/tool_complete events.
 */
export function stripToolCallText(text: string): string {
  let result = text;
  let start: number;
  while ((start = result.indexOf('[Tool call:')) !== -1) {
    let depth = 1;
    let i = start + 1;
    for (; i < result.length && depth > 0; i++) {
      if (result[i] === '[') depth++;
      else if (result[i] === ']') depth--;
    }
    if (depth === 0) {
      result = result.slice(0, start) + result.slice(i);
    } else {
      result = result.slice(0, start);
      break;
    }
  }
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

const markdownComponents = {
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const isInline = !match && !String(children).includes('\n');

    if (isInline) {
      return (
        <code className="bg-vscode-inputBg/60 px-1.5 py-0.5 rounded text-[0.9em] text-vscode-editorFg" {...props}>
          {children}
        </code>
      );
    }

    const lang = match?.[1] || '';
    const codeStr = String(children).replace(/\n$/, '');

    if (lang === 'jsviz') {
      return <JsVizBlock code={codeStr} />;
    }

    return <CodeBlock language={lang} code={codeStr} />;
  },
  pre({ children }: any) {
    return <>{children}</>;
  },
  table({ children }: any) {
    return (
      <div className="overflow-x-auto my-2">
        <table className="border-collapse text-sm">{children}</table>
      </div>
    );
  },
  th({ children }: any) {
    return <th className="border border-vscode-widgetBorder px-2 py-1 bg-vscode-inputBg/60 text-left font-medium">{children}</th>;
  },
  td({ children }: any) {
    return <td className="border border-vscode-panelBorder px-2 py-1">{children}</td>;
  },
};

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [[rehypeKatex, { throwOnError: false, output: 'html' }]] as any;

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  const normalized = React.useMemo(() => normalizeHeadings(stripToolCallText(content)), [content]);
  const segments = React.useMemo(() => parseActionBlocks(normalized), [normalized]);

  if (segments.length === 1 && segments[0].type === 'markdown') {
    return (
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={markdownComponents}>
        {segments[0].content}
      </ReactMarkdown>
    );
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'action') return <ActionBlock key={i} {...seg.props} />;
        if (seg.type === 'trace') return <TraceBlock key={i} {...seg.props} />;
        return (
          <ReactMarkdown key={i} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={markdownComponents}>
            {seg.content}
          </ReactMarkdown>
        );
      })}
    </>
  );
};
