import { useDeferredValue, useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { contentCacheAtom, highlightAtom } from "../state/atoms";
import { searchContents, type SearchOptions } from "../lib/search";
import { useWorkspace } from "../hooks/useWorkspace";
import { Icon } from "./Icon";

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

function HitPreview({ text, col, len }: { text: string; col: number; len: number }) {
  const before = text.slice(Math.max(0, col - 30), col);
  const match = text.slice(col, col + len);
  const after = text.slice(col + len, col + len + 80);
  return (
    <span className="truncate">
      {col > 30 ? "…" : ""}
      {before}
      <mark className="rounded bg-[var(--mg-mark)] px-0.5 text-[var(--mg-mark-fg)]">{match}</mark>
      {after}
    </span>
  );
}

export function SearchPanel() {
  const cache = useAtomValue(contentCacheAtom);
  const setHighlight = useSetAtom(highlightAtom);
  const { openFile } = useWorkspace();
  const [query, setQuery] = useState("");
  const [opts, setOpts] = useState<SearchOptions>({
    caseSensitive: false,
    useRegex: false,
    wholeWord: false,
  });
  const deferred = useDeferredValue(query);

  const { results, total, error } = useMemo(
    () => searchContents(cache, deferred, opts),
    [cache, deferred, opts],
  );

  const jump = (path: string) => {
    openFile(path);
    setHighlight({
      term: query,
      caseSensitive: opts.caseSensitive,
      useRegex: opts.useRegex,
      nonce: Math.random(),
    });
  };

  const toggle = (k: keyof SearchOptions) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--mg-border)] p-2">
        <div
          className={`flex items-center gap-1.5 rounded-lg border bg-[var(--mg-input-bg)] px-2 transition focus-within:border-[var(--mg-accent)] ${
            error ? "border-[var(--mg-danger)]" : "border-[var(--mg-border)]"
          }`}
        >
          <Icon name="search" size={17} className="shrink-0 text-[var(--mg-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="全文検索…"
            className="w-full bg-transparent py-1.5 text-[13px] outline-none placeholder:text-[var(--mg-muted)]"
          />
        </div>
        <div className="mt-1.5 flex gap-1">
          {(
            [
              ["caseSensitive", "Aa", "大文字小文字を区別"],
              ["wholeWord", "W", "単語単位"],
              ["useRegex", ".*", "正規表現"],
            ] as const
          ).map(([k, label, title]) => (
            <button
              key={k}
              title={title}
              onClick={() => toggle(k)}
              className={`rounded px-1.5 py-0.5 font-mono text-[11px] transition ${
                opts[k]
                  ? "bg-[var(--mg-accent)] text-white"
                  : "text-[var(--mg-muted)] hover:bg-[var(--mg-hover)]"
              }`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto self-center text-[11px] text-[var(--mg-muted)]">
            {deferred && !error ? `${total} 件 / ${results.length} ファイル` : ""}
            {error ? "正規表現エラー" : ""}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {results.map((fh) => (
          <div key={fh.path} className="mb-1">
            <div className="sticky top-0 flex items-center gap-1.5 bg-[var(--mg-panel)] px-2 py-1 text-[12px] font-medium text-[var(--mg-fg-dim)]">
              <span className="truncate">{basename(fh.path)}</span>
              <span className="truncate text-[11px] text-[var(--mg-muted)]">{fh.path}</span>
              <span className="ml-auto shrink-0 rounded-full bg-[var(--mg-hover)] px-1.5 text-[10px] text-[var(--mg-muted)]">
                {fh.hits.length}
              </span>
            </div>
            {fh.hits.map((hit, i) => (
              <button
                key={i}
                onClick={() => jump(fh.path)}
                className="flex w-full items-baseline gap-2 px-2 py-0.5 text-left text-[12px] text-[var(--mg-fg-dim)] transition hover:bg-[var(--mg-hover)]"
              >
                <span className="w-8 shrink-0 text-right font-mono text-[10px] text-[var(--mg-muted)]">
                  {hit.line}
                </span>
                <HitPreview text={hit.preview} col={hit.column} len={hit.length} />
              </button>
            ))}
          </div>
        ))}
        {deferred && !error && results.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-[var(--mg-muted)]">
            ヒットなし
          </div>
        )}
      </div>
    </div>
  );
}
