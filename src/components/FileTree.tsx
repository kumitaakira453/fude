import { confirm as dialogConfirm } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { useWorkspace } from "../hooks/useWorkspace";
import { openCountsAtom } from "../state/review";
import { DND_MIME, readDragPayload, setDragPayload } from "../lib/dnd";
import {
  availableApps,
  type ExternalApp,
  openWith,
  revealInFinder,
} from "../lib/external";
import { displayName, type TreeNode } from "../lib/fsAccess";
import { openToSide } from "../lib/ui";
import {
  activePath,
  activeFolderIdAtom,
  activePaneAtom,
  expandedByFolderAtom,
  revealInTreeAtom,
  treeAtom,
  treeFilterAtom,
} from "../state/atoms";
import { Icon } from "./Icon";


interface MenuState {
  x: number;
  y: number;
  node: TreeNode;
}
interface Creating {
  parentPath: string;
  kind: "file" | "dir";
}

function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  if (!q) return nodes;
  const lower = q.toLowerCase();
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.kind === "file") {
      if (
        n.name.toLowerCase().includes(lower) ||
        n.path.toLowerCase().includes(lower)
      )
        out.push(n);
    } else if (n.children) {
      const children = filterTree(n.children, q);
      if (children.length) out.push({ ...n, children });
    }
  }
  return out;
}

interface ItemCtx {
  expanded: Set<string>;
  filtering: boolean;
  toggle: (path: string) => void;
  onContext: (e: React.MouseEvent, node: TreeNode) => void;
  editingPath: string | null;
  commitRename: (node: TreeNode, name: string) => void;
  cancelRename: () => void;
  creating: Creating | null;
  commitCreate: (name: string) => void;
  cancelCreate: () => void;
  dragOverPath: string | null;
  setDragOverPath: (p: string | null) => void;
  onMoveDrop: (destDir: string, e: React.DragEvent) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
}

function NameInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
  pad,
  icon,
}: {
  initial: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
  pad: number;
  icon: string;
}) {
  const [v, setV] = useState(initial);
  const ime = useImeSafeEnter();
  return (
    <div
      className="flex h-7 items-center gap-1"
      style={{ paddingLeft: `${pad}px` }}
    >
      <Icon name={icon} size={16} className="shrink-0 text-[var(--mg-muted)]" />
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onKeyDown={(e) => {
          if (ime.isComposing(e)) return;
          if (e.key === "Enter") onCommit(v);
          else if (e.key === "Escape") onCancel();
        }}
        onBlur={() => onCommit(v)}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded border border-[var(--mg-accent)] bg-[var(--mg-input-bg)] px-1 py-0.5 text-[13px] outline-none"
      />
    </div>
  );
}

function TreeItem({
  node,
  depth,
  ctx,
}: {
  node: TreeNode;
  depth: number;
  ctx: ItemCtx;
}) {
  const activePane = useAtomValue(activePaneAtom);
  const openCounts = useAtomValue(openCountsAtom);
  const { openFile } = useWorkspace();
  const isOpen = ctx.filtering || ctx.expanded.has(node.path);
  const basePad = depth * 14 + 8;

  const startDrag = (e: React.DragEvent) => {
    setDragPayload(e.dataTransfer, { path: node.path });
    e.dataTransfer.effectAllowed = "copyMove";
  };

  if (node.kind === "dir") {
    const isDropTarget = ctx.dragOverPath === node.path;
    return (
      <div>
        {ctx.editingPath === node.path ? (
          <NameInput
            initial={node.name}
            onCommit={(v) => ctx.commitRename(node, v)}
            onCancel={ctx.cancelRename}
            pad={basePad}
            icon="folder"
          />
        ) : (
          <div
            role="button"
            tabIndex={0}
            draggable
            data-path={node.path}
            onDragStart={startDrag}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DND_MIME)) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              ctx.setDragOverPath(node.path);
            }}
            onDragLeave={() =>
              ctx.dragOverPath === node.path && ctx.setDragOverPath(null)
            }
            onDrop={(e) => {
              e.stopPropagation();
              ctx.onMoveDrop(node.path, e);
            }}
            onClick={() => ctx.toggle(node.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                ctx.toggle(node.path);
              }
            }}
            onContextMenu={(e) => ctx.onContext(e, node)}
            style={{ paddingLeft: `${basePad}px` }}
            className={`group flex h-7 w-full cursor-pointer items-center gap-1 rounded-md pr-1.5 text-left text-[13px] text-[var(--mg-fg-dim)] outline-none transition ${
              isDropTarget
                ? "bg-[var(--mg-accent-soft)] ring-1 ring-inset ring-[var(--mg-accent)]"
                : "hover:bg-[var(--mg-hover)]"
            }`}
          >
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
            {/* ホバー時に「このフォルダ内に作成」アクション */}
            <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
              <span
                role="button"
                tabIndex={-1}
                title="このフォルダに新規ファイル"
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.onNewFile(node.path);
                }}
                className="grid h-5 w-5 place-items-center rounded text-[var(--mg-muted)] hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
              >
                <Icon name="note_add" size={14} />
              </span>
              <span
                role="button"
                tabIndex={-1}
                title="このフォルダに新規フォルダ"
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.onNewFolder(node.path);
                }}
                className="grid h-5 w-5 place-items-center rounded text-[var(--mg-muted)] hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
              >
                <Icon name="create_new_folder" size={14} />
              </span>
            </span>
          </div>
        )}
        {isOpen && (
          <div>
            {ctx.creating?.parentPath === node.path && (
              <NameInput
                initial=""
                placeholder={
                  ctx.creating.kind === "dir"
                    ? "新しいフォルダ名"
                    : "新しいファイル名"
                }
                onCommit={ctx.commitCreate}
                onCancel={ctx.cancelCreate}
                pad={(depth + 1) * 14 + 8}
                icon={ctx.creating.kind === "dir" ? "folder" : "markdown"}
              />
            )}
            {node.children!.map((c) => (
              <TreeItem key={c.path} node={c} depth={depth + 1} ctx={ctx} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (ctx.editingPath === node.path) {
    return (
      <NameInput
        initial={node.name}
        onCommit={(v) => ctx.commitRename(node, v)}
        onCancel={ctx.cancelRename}
        pad={basePad + 18}
        icon="markdown"
      />
    );
  }

  const active = activePath(activePane) === node.path;
  const reviewCount = openCounts.get(node.path) ?? 0;
  return (
    <button
      draggable
      data-path={node.path}
      onDragStart={startDrag}
      onClick={() => openFile(node.path)}
      onContextMenu={(e) => ctx.onContext(e, node)}
      style={{ paddingLeft: `${basePad}px` }}
      className={`group relative flex h-7 w-full items-center gap-1 rounded-md pr-2 text-left text-[13px] transition ${
        active
          ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)]"
          : "text-[var(--mg-fg-dim)] hover:bg-[var(--mg-hover)]"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--mg-accent)]" />
      )}
      <span className="w-[18px] shrink-0" />
      <Icon
        name="markdown"
        size={16}
        fill={active}
        className={
          active
            ? "shrink-0 text-[var(--mg-accent)]"
            : "shrink-0 text-[var(--mg-muted)]"
        }
      />
      <span className="truncate">{displayName(node.name)}</span>
      {reviewCount > 0 && (
        <span
          title={`未解決の指摘 ${reviewCount} 件`}
          className="ml-auto shrink-0 rounded-full bg-[var(--mg-accent-soft)] px-1.5 text-[10.5px] font-medium text-[var(--mg-accent)]"
        >
          {reviewCount}
        </span>
      )}
    </button>
  );
}

function ContextMenu({
  menu,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: {
  menu: MenuState;
  onClose: () => void;
  onNewFile: (n: TreeNode) => void;
  onNewFolder: (n: TreeNode) => void;
  onRename: (n: TreeNode) => void;
  onDelete: (n: TreeNode) => void;
}) {
  const { openFile, getRootPath } = useWorkspace();
  const store = useStore();
  const { node } = menu;
  const root = getRootPath();
  const absPath = root ? `${root}/${node.path}` : node.path;
  // 実在するエディタだけを項目に出す（押しても無反応になるのを避ける）
  const [editors, setEditors] = useState<ExternalApp[]>([]);
  useEffect(() => {
    let alive = true;
    void availableApps().then((a) => {
      if (alive) setEditors(a);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const copy = (t: string) =>
    void navigator.clipboard.writeText(t).catch(() => {});
  type MI =
    | { icon: string; label: string; action: () => void; danger?: boolean }
    | "sep";
  // Finder / 外部エディタで開く（ファイル・フォルダ共通）
  const externalItems: MI[] = [
    {
      icon: "folder_open",
      label: "Finder で表示",
      action: () => revealInFinder(absPath),
    },
    ...editors.map((a) => ({
      icon: a.icon,
      label: a.label,
      action: () => openWith(absPath, a.app),
    })),
  ];
  const pathItems: MI[] = [
    {
      icon: "content_copy",
      label: "相対パスをコピー",
      action: () => copy(node.path),
    },
    {
      icon: "file_copy",
      label: "絶対パスをコピー",
      action: () => copy(absPath),
    },
  ];
  const commonItems: MI[] = [
    "sep",
    {
      icon: "drive_file_rename_outline",
      label: "名前を変更",
      action: () => onRename(node),
    },
    {
      icon: "delete",
      label: "削除",
      action: () => onDelete(node),
      danger: true,
    },
    "sep",
    ...externalItems,
    "sep",
    ...pathItems,
  ];
  const items: MI[] =
    node.kind === "file"
      ? [
          {
            icon: "markdown",
            label: "開く",
            action: () => openFile(node.path),
          },
          {
            icon: "vertical_split",
            label: "横に開く",
            action: () => openToSide(store, node.path),
          },
          ...commonItems,
        ]
      : [
          {
            icon: "note_add",
            label: "新規ファイル",
            action: () => onNewFile(node),
          },
          {
            icon: "create_new_folder",
            label: "新規フォルダ",
            action: () => onNewFolder(node),
          },
          ...commonItems,
        ];

  const rows = items.length;
  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 220),
    top: Math.min(menu.y, window.innerHeight - (rows * 30 + 16)),
  };

  return (
    <div
      style={style}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-52 rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] p-1.5 shadow-2xl"
    >
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="my-1 h-px bg-[var(--mg-border)]" />
        ) : (
          <button
            key={i}
            onClick={() => {
              it.action();
              onClose();
            }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition hover:bg-[var(--mg-hover)] ${
              it.danger ? "text-[var(--mg-danger)]" : "text-[var(--mg-fg-dim)]"
            }`}
          >
            <Icon
              name={it.icon}
              size={16}
              className={it.danger ? "" : "text-[var(--mg-muted)]"}
            />
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}

export function FileTree() {
  const tree = useAtomValue(treeAtom);
  const filter = useAtomValue(treeFilterAtom);
  const activeFolderId = useAtomValue(activeFolderIdAtom);
  const [expandedByFolder, setExpandedByFolder] = useAtom(expandedByFolderAtom);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [rootDragOver, setRootDragOver] = useState(false);
  const { createFile, createFolder, renameEntry, deleteEntry, moveEntry } =
    useWorkspace();
  const filtered = useMemo(() => filterTree(tree, filter), [tree, filter]);

  useEffect(() => {
    if (!activeFolderId || tree.length === 0) return;
    if (activeFolderId in expandedByFolder) return;
    const topDirs = tree.filter((n) => n.kind === "dir").map((n) => n.path);
    setExpandedByFolder((prev) => ({ ...prev, [activeFolderId]: topDirs }));
  }, [activeFolderId, tree, expandedByFolder, setExpandedByFolder]);

  const expanded = useMemo(
    () =>
      new Set(activeFolderId ? (expandedByFolder[activeFolderId] ?? []) : []),
    [expandedByFolder, activeFolderId],
  );

  const setExpandedOpen = (path: string) => {
    if (!activeFolderId) return;
    setExpandedByFolder((prev) => {
      const set = new Set(prev[activeFolderId] ?? []);
      set.add(path);
      return { ...prev, [activeFolderId]: [...set] };
    });
  };

  const toggle = (path: string) => {
    if (!activeFolderId) return;
    setExpandedByFolder((prev) => {
      const set = new Set(prev[activeFolderId] ?? []);
      if (set.has(path)) set.delete(path);
      else set.add(path);
      return { ...prev, [activeFolderId]: [...set] };
    });
  };

  // パンくず等からの「ツリーで表示」: 祖先を展開し、対象行へスクロール＋強調
  const listRef = useRef<HTMLDivElement>(null);
  const reveal = useAtomValue(revealInTreeAtom);
  useEffect(() => {
    if (!reveal || !activeFolderId) return;
    const target = reveal.path;
    const segs = target.split("/");
    const ancestors: string[] = [];
    for (let i = 1; i < segs.length; i++) {
      ancestors.push(segs.slice(0, i).join("/"));
    }
    if (ancestors.length) {
      setExpandedByFolder((prev) => {
        const set = new Set(prev[activeFolderId] ?? []);
        ancestors.forEach((a) => set.add(a));
        return { ...prev, [activeFolderId]: [...set] };
      });
    }
    // 展開が反映されてから対象行を探してスクロール＆強調
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = listRef.current?.querySelector<HTMLElement>(
          `[data-path="${CSS.escape(target)}"]`,
        );
        if (!el) return;
        // リストが十分スクロール可能なら中央付近に、そうでなければ見える位置に。
        el.scrollIntoView({ block: "center" });
        el.classList.add("mg-tree-reveal");
        window.setTimeout(() => el.classList.remove("mg-tree-reveal"), 1400);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [reveal, activeFolderId, setExpandedByFolder]);

  const startCreate = (parentPath: string, kind: "file" | "dir") => {
    if (parentPath) setExpandedOpen(parentPath);
    setCreating({ parentPath, kind });
  };

  const ctx: ItemCtx = {
    expanded,
    filtering: !!filter,
    toggle,
    onContext: (e, node) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, node });
    },
    editingPath,
    commitRename: (node, name) => {
      setEditingPath(null);
      void renameEntry(node.path, name, node.kind === "dir");
    },
    cancelRename: () => setEditingPath(null),
    creating,
    commitCreate: (name) => {
      if (creating && name.trim()) {
        if (creating.kind === "dir")
          void createFolder(creating.parentPath, name);
        else void createFile(creating.parentPath, name);
      }
      setCreating(null);
    },
    cancelCreate: () => setCreating(null),
    dragOverPath,
    setDragOverPath,
    onMoveDrop: (destDir, e) => {
      // タブを掴んだものはファイルの移動として扱わない
      const payload = readDragPayload(e.dataTransfer);
      setDragOverPath(null);
      if (payload && !payload.from) {
        e.preventDefault();
        void moveEntry(payload.path, destDir);
      }
    },
    onNewFile: (parentPath) => startCreate(parentPath, "file"),
    onNewFolder: (parentPath) => startCreate(parentPath, "dir"),
  };

  const askDelete = async (node: TreeNode) => {
    const ok = await dialogConfirm(
      `「${node.name}」を削除しますか？${node.kind === "dir" ? "\n中身ごと削除されます。" : ""}`,
      { title: "削除の確認", kind: "warning" },
    );
    if (ok) void deleteEntry(node.path, node.kind === "dir");
  };

  const onRootDrop = (e: React.DragEvent) => {
    setRootDragOver(false);
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    const payload = readDragPayload(e.dataTransfer);
    e.preventDefault();
    if (payload && !payload.from) void moveEntry(payload.path, ""); // ルートへ移動
  };

  return (
    <div className="flex min-h-0 flex-col">
      {/* ルート操作ツールバー（VSCode Explorer 風） */}
      <div className="flex items-center gap-0.5 px-2 pb-1">
        <span className="mr-auto text-[11px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
          エクスプローラー
        </span>
        <button
          onClick={() => startCreate("", "file")}
          title="ルートに新規ファイル"
          className="grid h-6 w-6 place-items-center rounded text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          <Icon name="note_add" size={16} />
        </button>
        <button
          onClick={() => startCreate("", "dir")}
          title="ルートに新規フォルダ"
          className="grid h-6 w-6 place-items-center rounded text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          <Icon name="create_new_folder" size={16} />
        </button>
      </div>

      <div
        ref={listRef}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setRootDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setRootDragOver(false);
        }}
        onDrop={onRootDrop}
        className={`min-h-full flex-1 rounded py-1 pl-1 ${
          rootDragOver ? "ring-1 ring-inset ring-[var(--mg-accent)]" : ""
        }`}
      >
        {creating?.parentPath === "" && (
          <NameInput
            initial=""
            placeholder={
              creating.kind === "dir" ? "新しいフォルダ名" : "新しいファイル名"
            }
            onCommit={ctx.commitCreate}
            onCancel={ctx.cancelCreate}
            pad={8}
            icon={creating.kind === "dir" ? "folder" : "markdown"}
          />
        )}
        {filtered.length === 0 && !creating ? (
          <div className="px-3 py-8 text-center text-xs text-[var(--mg-muted)]">
            {filter
              ? "一致するファイルがありません"
              : "Markdown ファイルがありません"}
          </div>
        ) : (
          filtered.map((n) => (
            <TreeItem key={n.path} node={n} depth={0} ctx={ctx} />
          ))
        )}
      </div>

      {menu && (
        <ContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onNewFile={(n) => startCreate(n.path, "file")}
          onNewFolder={(n) => startCreate(n.path, "dir")}
          onRename={(n) => setEditingPath(n.path)}
          onDelete={askDelete}
        />
      )}
    </div>
  );
}
