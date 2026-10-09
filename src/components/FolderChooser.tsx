import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { folderDisplayName, type FolderEntry } from "../lib/idb";
import { ago } from "../lib/when";
import { foldersAtom } from "../state/atoms";
import { Icon } from "./Icon";
import { keyedIn, movedIn } from "../lib/pointer";

// ワークスペースに並べるフォルダを、開いたことのあるフォルダから選ぶ段。
// ⌘⇧P の一覧の中で、「新しく作る」と「フォルダを足す」に使う。
//
// OS のダイアログは、一覧に無いフォルダを選ぶときだけ（末尾の「その他のフォルダ…」）。

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
  // 塗りは CSS の :hover で即座に出す。状態はキー操作を続ける起点だけに使う。
  const byMouse = useRef(false);
  const hover = (i: number) =>
    setActive((a) => {
      if (a === i) return a;
      byMouse.current = true;
      return i;
    });
  const ime = useImeSafeEnter();
  const now = useMemo(() => Date.now(), []);

  const rows = useMemo(
    () =>
      [...folders]
        .filter((f) => !hidden.includes(f.path) && matches(f, query))
        .sort((a, b) => b.lastOpened - a.lastOpened),
    [folders, hidden, query],
  );
  // 末尾の「その他のフォルダ…」も選べる行として数える。
  const total = rows.length + 1;

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    // マウスで当てた行はもう見えている。スクロールさせない。
    if (byMouse.current) {
      byMouse.current = false;
      return;
    }
    keyedIn(listRef.current);
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

  const footNote =
    picked.length > 0
      ? `${picked.length} 個のフォルダを選択中`
      : "選んでいないときは、カーソルのあるフォルダを使います";

  return (
    <>
      <div className="mg-pal-in">
        <button title="一覧へ戻る (Esc)" onClick={onBack} className="mg-ibtn -ml-1.5">
          <Icon name="chevron_left" size={16} />
        </button>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyUp={ime.onKeyUp}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={onKey}
          placeholder={mode === "create" ? "フォルダを選ぶ…" : "追加するフォルダを選ぶ…"}
        />
      </div>

      {mode === "create" && (
        <div className="mg-pick-name">
          <span>名前</span>
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
            placeholder="空欄なら最初のフォルダ名になります"
          />
        </div>
      )}

      <div ref={listRef} className="mg-pick-list max-h-[46vh] overflow-y-auto py-1">
        {rows.length === 0 && (
          <div className="mg-pal-note text-center">
            {folders.length === 0 ? "以前開いたフォルダはまだありません" : "一致するフォルダがありません"}
          </div>
        )}
        {rows.map((f, i) => {
          const on = picked.includes(f.path);
          const order = picked.indexOf(f.path);
          return (
            <div
              key={f.path}
              data-idx={i}
              onMouseMove={(e) => movedIn(e) && hover(i)}
              onClick={() => toggle(f.path)}
              data-on={i === active || undefined}
              className="mg-pick-row mg-pal-row cursor-pointer"
            >
              <span className={`mg-check${on ? " is-on" : ""}`} aria-hidden>
                {on && <Icon name="check" size={10} stroke={3} />}
              </span>
              <span className="mg-pal-name text-[var(--mg-fg)]">{folderDisplayName(f)}</span>
              {mode === "create" && order === 0 && picked.length > 1 && (
                <span className="mg-ws-pill-badge is-working">メイン</span>
              )}
              <span className="mg-pal-word font-[family-name:var(--mg-font-mono)] text-[length:11px]" title={f.path}>
                {f.path}
              </span>
              <span className="mg-pal-keys font-[family-name:var(--mg-font-mono)] text-[length:11px] text-[var(--mg-muted)]">
                {ago(f.lastOpened, now)}
              </span>
            </div>
          );
        })}
        <div
          data-idx={rows.length}
          onMouseMove={(e) => movedIn(e) && hover(rows.length)}
          onClick={() => void other()}
          data-on={active === rows.length || undefined}
          className="mg-pick-row mg-pal-row cursor-pointer"
        >
          <Icon name="folder_open" size={14} className="text-[var(--mg-muted)]" />
          その他のフォルダ…
        </div>
      </div>

      <div className="mg-pal-foot">
        <span className="mg-pal-foot-note" title={footNote}>
          {footNote}
        </span>
        <span>
          <kbd className="mg-key">space</kbd> 選ぶ
        </span>
        <span>
          <kbd className="mg-key">⏎</kbd> {mode === "create" ? "作成" : "追加"}
        </span>
        {mode === "create" && (
          <span>
            <kbd className="mg-key">⌘⏎</kbd> 新しいウィンドウで作成
          </span>
        )}
        <button
          onClick={() => done(false)}
          disabled={picked.length === 0 && !rows[active]}
          className="mg-go"
        >
          {mode === "create" ? "作成" : "追加"}
        </button>
      </div>
    </>
  );
}
