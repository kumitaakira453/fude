import { useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

// コードフェンスの言語ラベル + コピー ボタン付きラッパー（pre の描画差し替え）。
export function CodeBlock({
  language,
  children,
}: {
  language: string | null;
  children: ReactNode;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = preRef.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* クリップボード不可時は無視 */
    }
  };

  return (
    <div className="mg-codeblock group relative my-4 overflow-hidden rounded-xl border border-[var(--mg-border)] bg-[var(--mg-code-bg)] shadow-sm">
      <div className="flex items-center justify-between border-b border-[var(--mg-border)] bg-[var(--mg-code-head)] px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--mg-muted)]">
          {language || "text"}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-[var(--mg-muted)] transition hover:bg-[var(--mg-accent-soft)] hover:text-[var(--mg-accent)]"
        >
          <Icon name={copied ? "check" : "content_copy"} size={13} />
          {copied ? "コピー済" : "コピー"}
        </button>
      </div>
      <pre ref={preRef} className="overflow-x-auto text-[13.5px]">
        {children}
      </pre>
    </div>
  );
}
