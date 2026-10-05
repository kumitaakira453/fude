import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { folderDisplayName, type FolderEntry } from "../lib/idb";
import { ago } from "../lib/when";
import { foldersAtom } from "../state/atoms";
import { Icon } from "./Icon";

// ワークスペースに並べるフォルダを、開いたことのあるフォルダから選ぶ段。
// ⌘⇧P の一覧の中で、「新しく作る」と「フォルダを足す」に使う。
//
// OS のダイアログは、一覧に無いフォルダを選ぶときだけ（末尾の「ほかのフォルダ…」）。

export type ChooseMode = "create" | "add";

function matches(entry: FolderEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${folderDisplayName(entry)} ${entry.path}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export function FolderChooser({
  mode,
  initial,
  hidden,
  onDone,
  onBack,
  pickOther,
}: {
  mode: ChooseMode;
  // 最初から印を付けておくフォルダ（作るときは今のワークスペースのフォルダ）。
  initial: readonly string[];
  // 並べないフォルダ（足すときは既に並んでいるもの）。
  hidden: readonly string[];
  onDone: (roots: string[], name: string, newWindow: boolean) => void;
  onBack: () => void;
  pickOther: () => Promise<string | null>;
}) {
  const folders = useAtomValue(foldersAtom);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  // 印を付けた順を保つ（先頭が主のフォルダになる）。
  const [picked, setPicked] = useState<string[]>(() =>
    initial.filter((p) => !hidden.includes(p)),
  );
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const ime = useImeSafeEnter();
  const now = useMemo(() => Date.now(), []);

  const rows = useMemo(
    () =>
      [...folders]
        .filter((f) => !hidden.includes(f.path) && matches(f, query))
        .sort((a, b) => b.lastOpened - a.lastOpened),
    [folders, hidden, query],
  );
  // 末尾の「ほかのフォルダ…」も選べる行として数える。
  const total = rows.length + 1;

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const toggle = (path: string) =>
    setPicked((was) => (was.includes(path) ? was.filter((p) => p !== path) : [...was, path]));

  const other = async () => {
    const dir = await pickOther();
    if (dir && !hidden.includes(dir)) {
      setPicked((was) => (was.includes(dir) ? was : [...was, dir]));
    }
  };

  // 印が無ければ、選んでいる行のフォルダ 1 つで決める（Enter 1 回で済むように）。
  const done = (newWindow: boolean) => {
    const roots = picked.length > 0 ? picked : rows[active] ? [rows[active].path] : [];
    if (roots.length > 0) onDone(roots, name, newWindow);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (ime.isComposing(e)) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === " " && query === "" && rows[active]) {
      // 絞り込みを打っていないときだけ、Space は印の入切。打っているときは字として通す。
      e.preventDefault();
      toggle(rows[active].path);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active === rows.length) void other();
      else done(e.metaKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onBack();
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--mg-border)] px-4">
        <button
          title="一覧へ戻る (Esc)"
          onClick={onBack}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--mg-muted)] hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          <Icon name="arrow_back" size={18} />
        </button>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyUp={ime.onKeyUp}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={onKey}
          placeholder={
            mode === "create"
              ? "並べるフォルダを選ぶ…（Space で印、Enter で作る）"
              : "足すフォルダを選ぶ…（Space で印、Enter で足す）"
          }
          className="w-full bg-transparent py-3 text-[15px] outline-none placeholder:text-[var(--mg-muted)]"
        />
      </div>

      {mode === "create" && (
        <div className="flex items-center gap-2 border-b border-[var(--mg-border)] px-4 py-2">
          <span className="shrink-0 text-[11.5px] text-[var(--mg-muted)]">名前</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyUp={ime.onKeyUp}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(e) => {
              if (ime.isComposing(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                done(e.metaKey);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onBack();
              }
            }}
            placeholder="空なら先頭のフォルダの名前"
            className="min-w-0 flex-1 rounded bg-transparent px-1 text-[13px] outline-none placeholder:text-[var(--mg-muted)]"
          />
        </div>
      )}

      <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1">
        {rows.length === 0 && (
          <div className="px-4 py-4 text-center text-[12.5px] text-[var(--mg-muted)]">
            {folders.length === 0 ? "開いたことのあるフォルダはまだありません" : "一致するフォルダがありません"}
          </div>
        )}
        {rows.map((f, i) => {
          const on = picked.includes(f.path);
          const order = picked.indexOf(f.path);
          return (
            <div
              key={f.path}
              data-idx={i}
              onMouseMove={() => setActive(i)}
              onClick={() => toggle(f.path)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-1.5 ${
                i === active ? "bg-[var(--mg-accent-soft)]" : ""
              }`}
            >
              <Icon
                name={on ? "check_box" : "check_box_outline_blank"}
                size={18}
                fill={on}
                className={on ? "text-[var(--mg-accent)]" : "text-[var(--mg-muted)]"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[13.5px] text-[var(--mg-fg)]">
                    {folderDisplayName(f)}
                  </span>
                  {mode === "create" && order === 0 && picked.length > 1 && (
                    <span className="shrink-0 text-[10px] text-[var(--mg-muted)]">主</span>
                  )}
                </div>
                <div className="truncate text-[11px] text-[var(--mg-muted)]" title={f.path}>
                  {f.path}
                </div>
              </div>
              <span className="shrink-0 text-[10.5px] text-[var(--mg-muted)]">
                {ago(f.lastOpened, now)}
              </span>
            </div>
          );
        })}
        <div
          data-idx={rows.length}
          onMouseMove={() => setActive(rows.length)}
          onClick={() => void other()}
          className={`flex cursor-pointer items-center gap-3 px-4 py-1.5 text-[13px] text-[var(--mg-fg-dim)] ${
            active === rows.length ? "bg-[var(--mg-accent-soft)]" : ""
          }`}
        >
          <Icon name="folder_open" size={18} className="text-[var(--mg-muted)]" />
          ほかのフォルダ…
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--mg-border)] px-3 py-1.5">
        <span className="text-[11px] text-[var(--mg-muted)]">
          {picked.length > 0 ? `${picked.length} 個のフォルダ` : "印が無ければ選んでいる行のフォルダ"}
        </span>
        <span className="ml-auto text-[10.5px] text-[var(--mg-muted)]">
          {mode === "create" ? "⏎ 作る　⌘⏎ 新しい窓に作る" : "⏎ 足す"}
        </span>
        <button
          onClick={() => done(false)}
          disabled={picked.length === 0 && !rows[active]}
          className="rounded-md bg-[var(--mg-accent-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--mg-accent)] hover:opacity-80 disabled:opacity-40"
        >
          {mode === "create" ? "作る" : "足す"}
        </button>
      </div>
    </>
  );
}
