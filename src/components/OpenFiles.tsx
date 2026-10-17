import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { keyedIn, movedIn } from "../lib/pointer";
import { activateTab, closeTabAt } from "../lib/ui";
import { ago } from "../lib/when";
import {
  activePaneIdAtom,
  openFilesOpenAtom,
  panesAtom,
  pathLabelAtom,
  recentFilesAtom,
} from "../state/atoms";
import { openCountsAtom } from "../state/review";
import { FileIcon } from "./FileIcon";
import { Icon } from "./Icon";
import { Marked } from "./Marked";
import { PathText, PickDetail, PickPanel } from "./PickPanel";

// 開いているファイルの一覧（⌘L）。全部のペインのタブを、最近見た順に並べる。
// 開いた時点で直前に見ていたものを選んでおき、⏎ でそこへ移る。⌘W で選んでいる
// ファイルのタブを閉じる（一覧は開いたまま）。

interface Row {
  path: string;
  // そのファイルを出しているペイン（並びの順）。
  panes: string[];
}

const baseName = (path: string): string => path.split("/").pop() ?? path;

export function OpenFiles() {
  const [open, setOpen] = useAtom(openFilesOpenAtom);
  const panes = useAtomValue(panesAtom);
  const activeId = useAtomValue(activePaneIdAtom);
  const recent = useAtomValue(recentFilesAtom);
  const label = useAtomValue(pathLabelAtom);
  const counts = useAtomValue(openCountsAtom);
  const store = useStore();
  const ime = useImeSafeEnter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef(false);
  const byMouse = useRef(false);
  const now = useMemo(() => Date.now(), [open]);

  // 全部のペインのタブ。重なりは 1 つにし、出しているペインを添える。最近見た順、
  // 見たことの無いものはタブの順で後ろ。
  const all = useMemo(() => {
    const byPath = new Map<string, Row>();
    for (const pane of panes) {
      for (const path of pane.tabs) {
        const row = byPath.get(path) ?? { path, panes: [] };
        row.panes.push(pane.id);
        byPath.set(path, row);
      }
    }
    const order = [...byPath.values()];
    return order
      .map((row, i) => ({ row, i, seen: recent.get(row.path) ?? -1 }))
      .sort((a, b) => b.seen - a.seen || a.i - b.i)
      .map(({ row }) => row);
  }, [panes, recent]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => {
      const hay = `${baseName(r.path)} ${label(r.path)}`.toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
  }, [all, query, label]);

  useEffect(() => {
    if (!open) return;
    typed.current = false;
    setQuery("");
    // 直前に見ていたもの（2 番目）を選んでおく。⏎ だけで行き来できる。
    setActive(all.length > 1 ? 1 : 0);
    // 開いた時点の並びで決める。開いている間にタブを閉じても選び直さない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (typed.current) setActive(0);
  }, [query]);
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(rows.length - 1, 0)));
  }, [rows.length]);
  useEffect(() => {
    if (byMouse.current) {
      byMouse.current = false;
      return;
    }
    keyedIn(listRef.current);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const close = () => setOpen(false);
  // そのファイルを出すペイン。今のペインにあればそこ、無ければ並びの先頭。
  const paneFor = (row: Row): string =>
    row.panes.includes(activeId) ? activeId : row.panes[0];

  const choose = (i: number) => {
    const row = rows[i];
    if (!row) return;
    close();
    const paneId = paneFor(row);
    const pane = store.get(panesAtom).find((p) => p.id === paneId);
    const index = pane?.tabs.indexOf(row.path) ?? -1;
    if (index >= 0) activateTab(store, paneId, index);
  };
  const shut = (i: number) => {
    const row = rows[i];
    if (row) closeTabAt(store, paneFor(row), row.path);
  };
  const hover = (i: number) =>
    setActive((a) => {
      if (a === i) return a;
      byMouse.current = true;
      return i;
    });

  const picked = rows[active];
  const shown = activePathOf(panes, activeId);
  const detail = picked ? (
    <PickDetail
      icon={<FileIcon name={baseName(picked.path)} size={16} />}
      title={baseName(picked.path)}
      facts={[
        picked.path === shown ? (
          <b>見ている</b>
        ) : recent.has(picked.path) ? (
          <b>{ago(recent.get(picked.path)!, now)}</b>
        ) : null,
        panes.length > 1
          ? picked.panes.map((id) => `${panes.findIndex((p) => p.id === id) + 1} 番目`).join("・") + "のペイン"
          : null,
        counts.get(picked.path) ? (
          <>
            未解決のコメント <b>{counts.get(picked.path)}</b> 件
          </>
        ) : null,
      ]}
      sections={[["場所", <PathText path={picked.path} />]]}
    />
  ) : (
    <span />
  );

  return (
    <PickPanel
      label="開いているファイル"
      onClose={close}
      listRef={listRef}
      detail={detail}
      head={
        <div className="mg-pal-in">
          <Icon name="search" size={15} stroke={1.7} className="text-[var(--mg-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              typed.current = true;
              setQuery(e.target.value);
            }}
            onKeyUp={ime.onKeyUp}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(e) => {
              if (ime.isComposing(e)) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(active);
              } else if ((e.metaKey || e.ctrlKey) && (e.key === "w" || e.key === "W")) {
                // 選んでいる行のタブを閉じる。窓全体の ⌘W（今のタブを閉じる）へは渡さない。
                e.preventDefault();
                e.stopPropagation();
                shut(active);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
            placeholder="開いているファイルを名前で絞り込み"
          />
          <kbd className="mg-key">esc</kbd>
        </div>
      }
      list={
        <>
          {rows.length > 0 && <div className="mg-pal-group">開いているファイル</div>}
          {rows.map((row, i) => {
            const name = baseName(row.path);
            const seen = recent.get(row.path);
            return (
              <div
                key={row.path}
                data-idx={i}
                data-on={i === active || undefined}
                onMouseMove={(e) => movedIn(e) && hover(i)}
                onClick={() => choose(i)}
                className="mg-pick-row mg-pal-row cursor-pointer"
              >
                <span className="mg-pal-ficon">
                  <FileIcon name={name} size={14} />
                </span>
                <span className="mg-pal-name">
                  <Marked text={name} query={query} />
                </span>
                <span className="mg-pal-keys mg-pal-word">
                  {row.path === shown ? "見ている" : seen ? ago(seen, now) : ""}
                </span>
              </div>
            );
          })}
          {rows.length === 0 && <p className="mg-pal-note">当てはまるものがありません</p>}
        </>
      }
      foot={
        <div className="mg-pal-foot">
          <span>
            <kbd className="mg-key">⏎</kbd> 切り替える
          </span>
          <span>
            <kbd className="mg-key">⌘W</kbd> 閉じる
          </span>
          <span>
            <kbd className="mg-key">↑</kbd>
            <kbd className="mg-key">↓</kbd> 選ぶ
          </span>
        </div>
      }
    />
  );
}

function activePathOf(panes: { id: string; tabs: string[]; active: number }[], id: string): string | null {
  const pane = panes.find((p) => p.id === id) ?? panes[0];
  return pane?.tabs[pane.active] ?? null;
}
