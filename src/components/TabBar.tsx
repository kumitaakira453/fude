import { useStore } from "jotai";
import { useState } from "react";
import { readDragPayload, setDragPayload } from "../lib/dnd";
import { displayName } from "../lib/fsAccess";
import { activateTab, closeTab, moveTab, openInPane } from "../lib/ui";
import type { LeafNode } from "../state/atoms";
import { Icon } from "./Icon";

// ペインが持つタブの並び。分割の各ペインがそれぞれ持つ。
// タブは掴んで別のペインへ移せる。ファイルツリーからここへ落として開くこともできる。

export function TabBar({ pane, isActive }: { pane: LeafNode; isActive: boolean }) {
  const store = useStore();
  // ドロップで差し込む位置。null なら受け付けていない。
  const [insertAt, setInsertAt] = useState<number | null>(null);

  if (pane.tabs.length === 0) return null;

  const accept = (e: React.DragEvent) =>
    e.dataTransfer.types.includes("application/x-mdglow-path");

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
      className="flex shrink-0 items-stretch overflow-x-auto border-b border-[var(--mg-border)] bg-[var(--mg-panel)]"
      onDragOver={(e) => {
        if (!accept(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        // タブの上に乗っていなければ末尾に差し込む
        setInsertAt((at) => at ?? pane.tabs.length);
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
            draggable
            onDragStart={(e) => {
              setDragPayload(e.dataTransfer, { path, from: { paneId: pane.id, index: i } });
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (!accept(e)) return;
              e.preventDefault();
              e.stopPropagation();
              // 中点より左なら手前、右なら後ろに差し込む
              const box = e.currentTarget.getBoundingClientRect();
              setInsertAt(e.clientX < box.left + box.width / 2 ? i : i + 1);
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
