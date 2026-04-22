import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { CodeBlock } from './CodeBlock';
import { JsVizBlock } from './JsVizBlock';

interface MarkdownContentProps {
  content: string;
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

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  const normalized = React.useMemo(() => normalizeHeadings(stripToolCallText(content)), [content]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, output: 'html' }]]}
      components={{
        code({ className, children, ...props }) {
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
        pre({ children }) {
          // Let the code component handle rendering
          return <>{children}</>;
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto my-2">
              <table className="border-collapse text-sm">{children}</table>
            </div>
          );
        },
        th({ children }) {
          return <th className="border border-vscode-widgetBorder px-2 py-1 bg-vscode-inputBg/60 text-left font-medium">{children}</th>;
        },
        td({ children }) {
          return <td className="border border-vscode-panelBorder px-2 py-1">{children}</td>;
        },
      }}
    >
      {normalized}
    </ReactMarkdown>
  );
};
