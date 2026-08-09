import { useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { filesAtom, paletteOpenAtom } from "../state/atoms";
import { quickOpen } from "../lib/search";
import { useWorkspace } from "../hooks/useWorkspace";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { Icon } from "./Icon";

// Cmd/Ctrl+P のクイックオープン（ファイル名ファジー検索）。
export function CommandPalette() {
  const [open, setOpen] = useAtom(paletteOpenAtom);
  const files = useAtomValue(filesAtom);
  const { openFile } = useWorkspace();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const ime = useImeSafeEnter();

  const results = useMemo(() => quickOpen(files, query), [files, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const choose = (i: number) => {
    const r = results[i];
    if (r) {
      openFile(r.node.path);
      setOpen(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--mg-border)] bg-[var(--mg-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--mg-border)] px-4">
          <Icon name="bolt" size={20} className="shrink-0 text-[var(--mg-accent)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(e) => {
            if (ime.isComposing(e)) return; // IME 変換中のキーを無視
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(active);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
            placeholder="ファイルを開く…（ファイル名で絞り込み）"
            className="w-full bg-transparent py-3 text-[15px] outline-none placeholder:text-[var(--mg-muted)]"
          />
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {results.map((r, i) => (
            <button
              key={r.node.path}
              data-idx={i}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
              className={`flex w-full flex-col items-start px-4 py-1.5 text-left transition ${
                i === active ? "bg-[var(--mg-accent-soft)]" : ""
              }`}
            >
              <span className="text-[13.5px] text-[var(--mg-fg)]">
                {r.node.name.replace(/\.(md|markdown|mdx|mdown|mkd)$/i, "")}
              </span>
              <span className="text-[11px] text-[var(--mg-muted)]">{r.node.path}</span>
            </button>
          ))}
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-[var(--mg-muted)]">
              ファイルが見つかりません
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
