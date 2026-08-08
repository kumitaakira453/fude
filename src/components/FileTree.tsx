import { useEffect, useMemo, useState } from "react";
import { useAtom, useAtomValue, useStore } from "jotai";
import {
  activeFolderIdAtom,
  activePaneAtom,
  expandedByFolderAtom,
  treeAtom,
  treeFilterAtom,
} from "../state/atoms";
import type { TreeNode } from "../lib/fsAccess";
import { useWorkspace } from "../hooks/useWorkspace";
import { openToSide } from "../lib/ui";
import { DND_MIME } from "../lib/dnd";
import { Icon } from "./Icon";

const MD_EXT_RE = /\.(md|markdown|mdx|mdown|mkd)$/i;

interface MenuState {
  x: number;
  y: number;
  node: TreeNode;
}

function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  if (!q) return nodes;
  const lower = q.toLowerCase();
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.kind === "file") {
      if (n.name.toLowerCase().includes(lower) || n.path.toLowerCase().includes(lower)) out.push(n);
    } else if (n.children) {
      const children = filterTree(n.children, q);
      if (children.length) out.push({ ...n, children });
    }
  }
  return out;
}

function IndentGuides({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <>
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} className="w-3.5 shrink-0 self-stretch border-l border-[var(--mg-border)]" />
      ))}
    </>
  );
}

function TreeItem({
  node,
  depth,
  filtering,
  expanded,
  toggle,
  onContext,
}: {
  node: TreeNode;
  depth: number;
  filtering: boolean;
  expanded: Set<string>;
  toggle: (path: string) => void;
  onContext: (e: React.MouseEvent, node: TreeNode) => void;
}) {
  const activePane = useAtomValue(activePaneAtom);
  const { openFile } = useWorkspace();
  const isOpen = filtering || expanded.has(node.path);

  if (node.kind === "dir") {
    return (
      <div>
        <button
          onClick={() => toggle(node.path)}
          onContextMenu={(e) => onContext(e, node)}
          className="group flex h-7 w-full items-center gap-1 rounded-md pr-2 text-left text-[13px] text-[var(--mg-fg-dim)] transition hover:bg-[var(--mg-hover)]"
        >
          <IndentGuides depth={depth} />
          <Icon
            name="chevron_right"
            size={18}
            className={`shrink-0 text-[var(--mg-muted)] transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
          />
          <Icon
            name={isOpen ? "folder_open" : "folder"}
            size={17}
            fill
            className="shrink-0 text-[var(--mg-accent2)]"
          />
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {isOpen && (
          <div>
            {node.children!.map((c) => (
              <TreeItem
                key={c.path}
                node={c}
                depth={depth + 1}
                filtering={filtering}
                expanded={expanded}
                toggle={toggle}
                onContext={onContext}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const active = activePane?.path === node.path;
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, node.path);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => openFile(node.path)}
      onContextMenu={(e) => onContext(e, node)}
      className={`group relative flex h-7 w-full items-center gap-1 rounded-md pr-2 text-left text-[13px] transition ${
        active
          ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)]"
          : "text-[var(--mg-fg-dim)] hover:bg-[var(--mg-hover)]"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--mg-accent)]" />
      )}
      <IndentGuides depth={depth} />
      <span className="w-[18px] shrink-0" />
      <Icon
        name="description"
        size={16}
        fill={active}
        className={active ? "shrink-0 text-[var(--mg-accent)]" : "shrink-0 text-[var(--mg-muted)]"}
      />
      <span className="truncate">{node.name.replace(MD_EXT_RE, "")}</span>
    </button>
  );
}

function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const store = useStore();
  const { openFile, getRootPath } = useWorkspace();
  const { node } = menu;
  const root = getRootPath();
  const absPath = root ? `${root}/${node.path}` : node.path;

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const copy = (text: string) => void navigator.clipboard.writeText(text).catch(() => {});

  const items: { icon: string; label: string; action: () => void }[] =
    node.kind === "file"
      ? [
          { icon: "description", label: "開く", action: () => openFile(node.path) },
          { icon: "vertical_split", label: "横に開く", action: () => openToSide(store, node.path) },
          { icon: "content_copy", label: "相対パスをコピー", action: () => copy(node.path) },
          { icon: "folder_open", label: "絶対パスをコピー", action: () => copy(absPath) },
          { icon: "title", label: "ファイル名をコピー", action: () => copy(node.name) },
        ]
      : [
          { icon: "content_copy", label: "相対パスをコピー", action: () => copy(node.path) },
          { icon: "folder_open", label: "絶対パスをコピー", action: () => copy(absPath) },
        ];

  // 画面外にはみ出さないよう位置を補正
  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 220),
    top: Math.min(menu.y, window.innerHeight - (items.length * 34 + 16)),
  };

  return (
    <div
      style={style}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-52 rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] p-1.5 shadow-2xl"
    >
      {items.map((it, i) => (
        <button
          key={i}
          onClick={() => {
            it.action();
            onClose();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[var(--mg-fg-dim)] transition hover:bg-[var(--mg-hover)]"
        >
          <Icon name={it.icon} size={16} className="text-[var(--mg-muted)]" />
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function FileTree() {
  const tree = useAtomValue(treeAtom);
  const filter = useAtomValue(treeFilterAtom);
  const activeFolderId = useAtomValue(activeFolderIdAtom);
  const [expandedByFolder, setExpandedByFolder] = useAtom(expandedByFolderAtom);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const filtered = useMemo(() => filterTree(tree, filter), [tree, filter]);

  useEffect(() => {
    if (!activeFolderId || tree.length === 0) return;
    if (activeFolderId in expandedByFolder) return;
    const topDirs = tree.filter((n) => n.kind === "dir").map((n) => n.path);
    setExpandedByFolder((prev) => ({ ...prev, [activeFolderId]: topDirs }));
  }, [activeFolderId, tree, expandedByFolder, setExpandedByFolder]);

  const expanded = useMemo(
    () => new Set(activeFolderId ? (expandedByFolder[activeFolderId] ?? []) : []),
    [expandedByFolder, activeFolderId],
  );

  const toggle = (path: string) => {
    if (!activeFolderId) return;
    setExpandedByFolder((prev) => {
      const set = new Set(prev[activeFolderId] ?? []);
      if (set.has(path)) set.delete(path);
      else set.add(path);
      return { ...prev, [activeFolderId]: [...set] };
    });
  };

  const onContext = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, node });
  };

  if (filtered.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-xs text-[var(--mg-muted)]">
        {filter ? "一致するファイルがありません" : "Markdown ファイルがありません"}
      </div>
    );
  }

  return (
    <div className="py-1 pl-1">
      {filtered.map((n) => (
        <TreeItem
          key={n.path}
          node={n}
          depth={0}
          filtering={!!filter}
          expanded={expanded}
          toggle={toggle}
          onContext={onContext}
        />
      ))}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
