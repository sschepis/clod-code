import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Oboto] UI crash:', error, info.componentStack);
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleClearSession = () => {
    try {
      const vscode = (window as any).acquireVsCodeApi?.() ?? (window as any).__vscode;
      vscode?.postMessage?.({ type: 'clear_session' });
    } catch { /* best effort */ }
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '2rem',
        gap: '1rem',
        color: 'var(--vscode-foreground)',
        fontFamily: 'var(--vscode-font-family)',
      }}>
        <div style={{ fontSize: '2rem' }}>&#x26A0;</div>
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Something went wrong</h2>
        <p style={{
          margin: 0,
          fontSize: '0.8rem',
          color: 'var(--vscode-descriptionForeground)',
          textAlign: 'center',
          maxWidth: '320px',
        }}>
          {this.state.error?.message || 'An unexpected error occurred in the UI.'}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={this.handleReload}
            style={{
              padding: '6px 14px',
              fontSize: '0.8rem',
              cursor: 'pointer',
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              borderRadius: '2px',
            }}
          >
            Reload
          </button>
          <button
            onClick={this.handleClearSession}
            style={{
              padding: '6px 14px',
              fontSize: '0.8rem',
              cursor: 'pointer',
              background: 'var(--vscode-button-secondaryBackground)',
              color: 'var(--vscode-button-secondaryForeground)',
              border: 'none',
              borderRadius: '2px',
            }}
          >
            Clear Session
          </button>
        </div>
      </div>
    );
  }
}
