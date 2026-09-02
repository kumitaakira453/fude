import { useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { filesAtom, paletteOpenAtom, touchedAtom } from "../state/atoms";
import { quickOpen } from "../lib/search";
import { useWorkspace } from "../hooks/useWorkspace";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { Icon } from "./Icon";

// 触ってからの経過。細かい数字は要らないので、桁が分かる粒度で出す。
function since(at: number | undefined, now: number): string {
  if (!at) return "";
  const min = (now - at) / 60000;
  if (min < 1) return "たった今";
  if (min < 60) return `${Math.floor(min)} 分前`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} 時間前`;
  const day = Math.floor(min / 60 / 24);
  return day < 30 ? `${day} 日前` : `${Math.floor(day / 30)} か月前`;
}

// Cmd/Ctrl+P のクイックオープン（ファイル名ファジー検索）。
// 並びは「名前の一致」と「最後に触った新しさ」で決める。
export function CommandPalette() {
  const [open, setOpen] = useAtom(paletteOpenAtom);
  const files = useAtomValue(filesAtom);
  const touched = useAtomValue(touchedAtom);
  const { openFile } = useWorkspace();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const ime = useImeSafeEnter();

  // 開いた時刻は開くたびに 1 度だけ決める。1 文字打つたびに now が動くと、
  // 同じ並びのはずのものが入れ替わって落ち着かない。
  const now = useMemo(() => Date.now(), [open]);
  const results = useMemo(
    () => quickOpen(files, query, { touched, now }),
    [files, query, touched, now],
  );

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
              <span className="flex w-full items-baseline gap-2 text-[13.5px] text-[var(--mg-fg)]">
                <span className="min-w-0 flex-1 truncate">
                  {r.node.name.replace(/\.(md|markdown|mdx|mdown|mkd)$/i, "")}
                </span>
                {/* いつ触ったか。並び順の理由が読めるように添える。 */}
                <span className="shrink-0 text-[10.5px] text-[var(--mg-muted)]">
                  {since(touched.get(r.node.path), now)}
                </span>
              </span>
              <span className="w-full truncate text-[11px] text-[var(--mg-muted)]">
                {r.node.path}
              </span>
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
