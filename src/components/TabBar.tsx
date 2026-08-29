import { useStore } from "jotai";
import { useState } from "react";
import { useDragReset } from "../hooks/useDragReset";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  dropPoint,
  droppedOutside,
  readDragPayload,
  setDragPayload,
} from "../lib/dnd";
import { setFileDragImage } from "../lib/dragImage";
import { displayName } from "../lib/fsAccess";
import {
  activateTab,
  closeTab,
  closeTabAt,
  moveTab,
  openInPane,
} from "../lib/ui";
import type { LeafNode } from "../state/atoms";
import { Icon } from "./Icon";

// ペインが持つタブの並び。分割の各ペインがそれぞれ持つ。
// タブは掴んで別のペインへ移せる。ファイルツリーからここへ落として開くこともできる。

export function TabBar({ pane, isActive }: { pane: LeafNode; isActive: boolean }) {
  const store = useStore();
  const { openInNewWindow } = useWorkspace();
  // ドロップで差し込む位置。null なら受け付けていない。
  const [insertAt, setInsertAt] = useState<number | null>(null);
  useDragReset(() => setInsertAt(null));

  if (pane.tabs.length === 0) return null;

  const accept = (e: React.DragEvent) =>
    e.dataTransfer.types.includes("application/x-mdglow-path");

  // 差し込み位置は子タブの矩形から決める。タブごとに handler を置くと、
  // 伝播の順番でコンテナ側が上書きしてしまう。
  const indexAt = (e: React.DragEvent<HTMLDivElement>): number => {
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-mg-tab]"));
    for (let i = 0; i < tabs.length; i++) {
      const box = tabs[i].getBoundingClientRect();
      if (e.clientX < box.left + box.width / 2) return i;
    }
    return tabs.length;
  };

  const drop = (e: React.DragEvent) => {
    const at = insertAt;
    setInsertAt(null);
    if (!accept(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const payload = readDragPayload(e.dataTransfer);
    if (!payload) return;
    if (payload.from) moveTab(store, payload.from, pane.id, at ?? pane.tabs.length);
    else openInPane(store, pane.id, payload.path);
  };

  return (
    <div
      role="tablist"
      data-mg-tabbar
      className="mg-tabbar flex shrink-0 items-stretch overflow-x-auto border-b border-[var(--mg-border)] bg-[var(--mg-panel)]"
      onDragOver={(e) => {
        if (!accept(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setInsertAt(indexAt(e));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setInsertAt(null);
      }}
      onDrop={drop}
    >
      {pane.tabs.map((path, i) => {
        const selected = i === pane.active;
        return (
          <div
            key={path}
            data-mg-tab
            draggable
            onDragStart={(e) => {
              setDragPayload(e.dataTransfer, { path, from: { paneId: pane.id, index: i } });
              e.dataTransfer.effectAllowed = "move";
              setFileDragImage(e.dataTransfer, displayName(path));
            }}
            // ウィンドウの外へ引き出したら、そのファイルを別ウィンドウへ移す。
            // タブを消すのはウィンドウができてから。先に消すと、開くまでの間
            // どちらにも無い状態が見えてしまう。
            onDragEnd={(e) => {
              if (!droppedOutside(e)) return;
              void openInNewWindow(path, dropPoint(e)).then((opened) => {
                if (opened) closeTabAt(store, pane.id, path);
              });
            }}
            className={`group relative flex max-w-[200px] items-center gap-1 border-r border-[var(--mg-border)] pl-3 pr-1.5 text-[12px] transition ${
              selected
                ? "bg-[var(--mg-bg)] text-[var(--mg-fg)]"
                : "text-[var(--mg-muted)] hover:bg-[var(--mg-hover)]"
            }`}
          >
            {selected && isActive && (
              <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--mg-accent)]" />
            )}
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              title={path}
              onClick={() => activateTab(store, pane.id, i)}
              // 中クリックで閉じる（タブの慣習）
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(store, pane.id, i);
                }
              }}
              className="truncate py-1.5"
            >
              {displayName(path)}
            </button>
            <button
              type="button"
              title="閉じる"
              onClick={() => closeTab(store, pane.id, i)}
              className="rounded p-0.5 opacity-0 transition hover:bg-[var(--mg-hover)] group-hover:opacity-100"
            >
              <Icon name="close" size={13} />
            </button>
            {insertAt === i && <Marker side="left" />}
            {insertAt === i + 1 && <Marker side="right" />}
          </div>
        );
      })}
    </div>
  );
}

// 差し込み位置の目印。
function Marker({ side }: { side: "left" | "right" }) {
  return (
    <span
      className={`pointer-events-none absolute inset-y-0 w-0.5 bg-[var(--mg-accent)] ${
        side === "left" ? "left-0" : "right-0"
      }`}
    />
  );
}
