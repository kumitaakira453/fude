import { useAtomValue, useStore } from "jotai";
import { useCallback, useRef, useState } from "react";
import { DND_MIME, readDragPayload } from "../lib/dnd";
import { dropOnPane, updateSplitSizes, type DropZone } from "../lib/ui";
import {
  activePaneIdAtom,
  layoutAtom,
  panesAtom,
  type LayoutNode,
  type LeafNode,
  type SplitNode,
} from "../state/atoms";
import { DocPane } from "./DocPane";
import { TabBar } from "./TabBar";

export function PaneGroup() {
  const root = useAtomValue(layoutAtom);
  const panes = useAtomValue(panesAtom);
  const isSplit = panes.length > 1;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <LayoutView node={root} isSplit={isSplit} />
    </div>
  );
}

function LayoutView({ node, isSplit }: { node: LayoutNode; isSplit: boolean }) {
  if (node.kind === "leaf") return <PaneCell leaf={node} isSplit={isSplit} />;
  return <SplitView node={node} isSplit={isSplit} />;
}

function SplitView({ node, isSplit }: { node: SplitNode; isSplit: boolean }) {
  const store = useStore();
  const isRow = node.dir === "row";
  const ref = useRef<HTMLDivElement>(null);
  const sizes =
    node.sizes.length === node.children.length
      ? node.sizes
      : node.children.map(() => 1 / node.children.length);

  const startDrag = useCallback(
    (i: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      const container = ref.current;
      if (!container) return;
      const base = sizes.slice();
      const rect = container.getBoundingClientRect();
      const start = isRow ? e.clientX : e.clientY;
      const total = isRow ? rect.width : rect.height;
      const pair = base[i] + base[i + 1];
      const onMove = (ev: PointerEvent) => {
        const delta = ((isRow ? ev.clientX : ev.clientY) - start) / total;
        const first = Math.min(pair - 0.1, Math.max(0.1, base[i] + delta));
        const nextSizes = base.slice();
        nextSizes[i] = first;
        nextSizes[i + 1] = pair - first;
        updateSplitSizes(store, node.id, nextSizes);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = isRow ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [sizes, isRow, node.id, store],
  );

  return (
    <div
      ref={ref}
      className={`flex min-h-0 min-w-0 flex-1 ${isRow ? "flex-row" : "flex-col"}`}
    >
      {node.children.map((child, i) => (
        <div key={child.id} className="contents">
          <div
            style={{ flexBasis: `${sizes[i] * 100}%` }}
            className="flex min-h-0 min-w-0 grow-0"
          >
            <LayoutView node={child} isSplit={isSplit} />
          </div>
          {i < node.children.length - 1 && (
            <div
              onPointerDown={startDrag(i)}
              onDoubleClick={() =>
                updateSplitSizes(
                  store,
                  node.id,
                  node.children.map(() => 1 / node.children.length),
                )
              }
              title="ドラッグでサイズ調整 / ダブルクリックで均等"
              className={`group relative shrink-0 bg-[var(--mg-border)] ${
                isRow ? "w-px cursor-col-resize" : "h-px cursor-row-resize"
              }`}
            >
              <span
                className={`absolute z-10 ${isRow ? "inset-y-0 -left-1.5 -right-1.5" : "inset-x-0 -top-1.5 -bottom-1.5"}`}
              />
              <span
                className={`absolute bg-[var(--mg-accent)] opacity-0 transition group-hover:opacity-100 ${
                  isRow ? "inset-y-0 left-0 w-px" : "inset-x-0 top-0 h-px"
                }`}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const ZONE_CLASS: Record<DropZone, string> = {
  center: "inset-0",
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
};

function zoneOf(e: React.DragEvent): DropZone {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  if (x > 0.3 && x < 0.7 && y > 0.3 && y < 0.7) return "center";
  const d: Record<DropZone, number> = {
    left: x,
    right: 1 - x,
    top: y,
    bottom: 1 - y,
    center: 1,
  };
  return (Object.keys(d) as DropZone[]).reduce(
    (a, b) => (d[b] < d[a] ? b : a),
    "left",
  );
}

function PaneCell({ leaf, isSplit }: { leaf: LeafNode; isSplit: boolean }) {
  const store = useStore();
  const activeId = useAtomValue(activePaneIdAtom);
  const [zone, setZone] = useState<DropZone | null>(null);

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DND_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setZone(zoneOf(e));
      }}
      onDragLeave={(e) => {
        // 子要素へ移動しただけなら無視
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null);
      }}
      onDrop={(e) => {
        const payload = readDragPayload(e.dataTransfer);
        const z = zoneOf(e);
        setZone(null);
        if (!payload) return;
        e.preventDefault();
        dropOnPane(store, leaf.id, z, payload.path, payload.from);
      }}
    >
      <TabBar pane={leaf} isActive={leaf.id === activeId} />
      <DocPane pane={leaf} isSplit={isSplit} />
      {zone && (
        <div
          className={`pointer-events-none absolute z-20 bg-[var(--mg-accent)]/15 ring-2 ring-inset ring-[var(--mg-accent)] ${ZONE_CLASS[zone]}`}
        />
      )}
    </div>
  );
}
