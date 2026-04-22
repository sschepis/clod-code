import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Code, Copy, Play, RefreshCw } from 'lucide-react';

interface JsVizBlockProps {
  code: string;
}

function buildIframeHtml(userCode: string, vizId: string): string {
  return `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0c0c0c;display:flex;flex-direction:column;align-items:center;padding:8px;overflow:hidden}
canvas{display:block;max-width:100%}
#error{display:none;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:4px;padding:8px 12px;color:#fca5a5;font-family:'Fira Code',monospace;font-size:12px;white-space:pre-wrap;width:100%}
</style></head><body>
<canvas id="canvas" width="600" height="400"></canvas>
<div id="error"></div>
<script>
(function(){
  var canvas=document.getElementById('canvas');
  var errorEl=document.getElementById('error');
  function showError(msg){
    canvas.style.display='none';
    errorEl.style.display='block';
    errorEl.textContent=msg;
    notify();
  }
  function notify(){
    parent.postMessage({type:'jsviz-resize',vizId:${JSON.stringify(vizId)},height:document.body.scrollHeight},'*');
  }
  try{
    ${userCode}
    if(typeof render!=='function'){showError('Error: No render(canvas) function defined');return;}
    var result=render(canvas);
    if(result&&typeof result.then==='function'){
      result.then(function(){notify()}).catch(function(e){showError('Async error: '+(e.message||String(e)))});
    }else{notify()}
  }catch(e){showError('Runtime error: '+(e.message||String(e)))}
})();
</script></body></html>`;
}

function copyToClipboard(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

export const JsVizBlock: React.FC<JsVizBlockProps> = ({ code }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const vizIdRef = useRef(crypto.randomUUID());
  const blobUrlRef = useRef<string | null>(null);

  const [approved, setApproved] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(416);
  const [runKey, setRunKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  useEffect(() => {
    if (!approved) return;

    const container = containerRef.current;
    if (!container) return;

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
    }

    const vizId = vizIdRef.current;
    const html = buildIframeHtml(code, vizId);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;

    container.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.sandbox.add('allow-scripts', 'allow-same-origin');
    iframe.src = url;
    iframe.style.width = '100%';
    iframe.style.height = `${iframeHeight}px`;
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    iframe.style.borderRadius = '0';
    container.appendChild(iframe);

    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'jsviz-resize' && e.data.vizId === vizId) {
        const h = Math.max(100, Math.min(e.data.height + 16, 800));
        setIframeHeight(h);
        iframe.style.height = `${h}px`;
      }
    };
    window.addEventListener('message', handler);

    return () => {
      window.removeEventListener('message', handler);
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [code, runKey, approved]);

  return (
    <div className="my-2 bg-[#0c0c0c] border border-vscode-panelBorder rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-vscode-widgetBg/80 border-b border-vscode-panelBorder">
        <span className="text-xs text-vscode-desc font-mono">jsviz</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSource(s => !s)}
            className={`p-1 transition-colors rounded ${showSource ? 'text-vscode-editorFg' : 'text-vscode-desc hover:text-vscode-editorFg'}`}
            title={showSource ? 'Hide source' : 'View source'}
          >
            <Code size={12} />
          </button>
          {approved && (
            <button
              onClick={() => setRunKey(k => k + 1)}
              className="p-1 text-vscode-desc hover:text-vscode-editorFg transition-colors rounded"
              title="Rerun"
            >
              <RefreshCw size={12} />
            </button>
          )}
          <button
            onClick={handleCopy}
            className="p-1 text-vscode-desc hover:text-vscode-editorFg transition-colors rounded"
            title="Copy code"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
        </div>
      </div>

      {!approved ? (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <p className="text-xs text-vscode-desc">This visualization wants to run JavaScript with network and DOM access.</p>
          <button
            onClick={() => setApproved(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded transition-colors"
          >
            <Play size={12} />
            Run
          </button>
        </div>
      ) : (
        <div ref={containerRef} />
      )}

      {showSource && (
        <div className="border-t border-vscode-panelBorder">
          <pre className="p-3 text-xs font-mono overflow-x-auto leading-relaxed">
            <code className="text-vscode-editorFg">{code}</code>
          </pre>
        </div>
      )}
    </div>
  );
};
