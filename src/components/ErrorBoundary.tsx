import { Component, type ReactNode } from "react";

// レンダー中の例外で「画面全体が真っ白」になるのを防ぎ、原因を可視化する。
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[fude error]", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--mg-bg)] p-8 text-[var(--mg-fg)]">
        <div className="max-w-lg">
          <div className="mb-2 text-sm font-semibold text-[var(--mg-danger)]">
            レンダリングエラーが発生しました
          </div>
          <pre className="mb-4 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--mg-border)] bg-[var(--mg-panel)] p-3 text-[11px] leading-relaxed text-[var(--mg-fg-dim)]">
            {/* 名前と文を必ず頭に出す。WebKit の stack には文が入らないので、
                stack だけを出すと「何が起きたか」が消える。 */}
            {[
              `${error.name ?? "Error"}: ${error.message || String(error)}`,
              error.stack,
            ]
              .filter(Boolean)
              .join("\n\n")}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-lg bg-[var(--mg-accent)] px-3 py-1.5 text-[13px] font-medium text-white"
          >
            復帰する
          </button>
        </div>
      </div>
    );
  }
}
