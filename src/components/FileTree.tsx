import { useAtom, useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { useWorkspace } from "../hooks/useWorkspace";
import type { DropPoint } from "../lib/windows";
import { openCountsAtom } from "../state/review";
import {
  DND_MIME,
  dropPoint,
  droppedOutside,
  readDragPayload,
  setDragPayload,
} from "../lib/dnd";
import { setDragChip } from "../lib/dragImage";
import { iconOf } from "../lib/kind";
import {
  ancestorPaths,
  displayName,
  filterTree,
  type TreeNode,
} from "../lib/fsAccess";
import {
  activeFolderIdAtom,
  expandedByFolderAtom,
  revealInTreeAtom,
  soleAtom,
  treeAtom,
  treeFilterAtom,
  isShownAtom,
} from "../state/atoms";
import { draftNameAtom, draftRelAtom } from "../state/drafts";
import { EntryMenu, type EntryMenuState } from "./EntryMenu";
import { Icon } from "./Icon";


interface Creating {
  parentPath: string;
  kind: "file" | "dir";
}

interface ItemCtx {
  expanded: Set<string>;
  filtering: boolean;
  // path ごとの未解決のコメントの数。
  counts: Map<string, number>;
  // ファイルを開く。行ごとに useWorkspace を呼ぶと、その中の useCallback
  // 29 個が行数だけ作り直される。
  openFile: (path: string) => void;
  openInNewWindow: (path: string, at?: DropPoint) => void;
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
        onKeyUp={ime.onKeyUp}
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

// 押した行を、その場で塗る。
//
// 押下 → store 更新 → React が描き直す、の順だと、同じ一枚に載っている
// 右ペインの仕事（大きいファイルでは秒の単位）が終わるまで塗られない。
// 見た目は data-on ひとつと CSS で決まっているので、React を待たずに
// 属性だけ先に書き換える。React は後から同じ値に落ち着くだけ。
function markOn(path: string): void {
  for (const el of document.querySelectorAll("[data-path][data-on]")) {
    if (el.getAttribute("data-path") !== path) el.removeAttribute("data-on");
  }
  document.querySelector(`[data-path="${CSS.escape(path)}"]`)
    ?.setAttribute("data-on", "");
}

// 行は memo で包む。選択が変わったときに描き直すのは、真偽が変わった 2 行だけ。
//
// ctx は親で useMemo して同じものを渡す。毎回作り直すと memo が素通りになる。
const TreeItem = memo(function TreeItem({
  node,
  depth,
  ctx,
}: {
  node: TreeNode;
  depth: number;
  ctx: ItemCtx;
}) {
  // 自分が出ているかだけを購読する。ペインを購読すると全行が起きる。
  const active = useAtomValue(isShownAtom(node.path));
  // 下書きは置き場で採った機械的な名前を持っているので、中身から採り直す。
  // フォルダを開いているあいだは空のままなので、行が起きることはない。
  const draftRel = useAtomValue(draftRelAtom);
  const draftName = useAtomValue(draftNameAtom);
  const isOpen = ctx.filtering || ctx.expanded.has(node.path);
  const basePad = depth * 14 + 8;

  const startDrag = (e: React.DragEvent) => {
    setDragPayload(e.dataTransfer, { path: node.path });
    e.dataTransfer.effectAllowed = "copyMove";
    setDragChip(e.dataTransfer, node.name);
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
            className={`group flex h-7 w-full cursor-pointer select-none items-center gap-1 rounded-md pr-1.5 text-left text-[13px] text-[var(--mg-fg-dim)] outline-none ${
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

  const reviewCount = ctx.counts.get(node.path) ?? 0;
  return (
    <button
      draggable
      data-path={node.path}
      onDragStart={startDrag}
      // ウィンドウの外へ引き出したら、そのファイルで新しいウィンドウを開く
      onDragEnd={(e) => {
        if (droppedOutside(e)) ctx.openInNewWindow(node.path, dropPoint(e));
      }}
      onClick={(e) => {
        if (e.metaKey) {
          // 別のウィンドウで開く経路。この木が出しているファイルは変わらない。
          ctx.openInNewWindow(node.path);
          return;
        }
        markOn(node.path);
        ctx.openFile(node.path);
      }}
      onContextMenu={(e) => ctx.onContext(e, node)}
      style={{ paddingLeft: `${basePad}px` }}
      // 出しているファイルかどうかは data-on ひとつで渡し、色は CSS が出す
      // （index.css の .mg-tree-row）。背景・文字色・アイコンをそれぞれの
      // class 文字列で切り替えると、遷移の掛かるものと掛からないものが混ざり、
      // 押した瞬間に一部だけ変わる。
      data-on={active || undefined}
      className="mg-tree-row group relative flex h-7 w-full select-none items-center gap-1 rounded-md pr-2 text-left text-[13px]"
    >
      {active && <span className="mg-tree-rail" />}
      <span className="w-[18px] shrink-0" />
      <Icon
        name={iconOf(node.name)}
        size={16}
        fill={active}
        className="mg-tree-ico shrink-0"
      />
      <span className="truncate">
        {node.path === draftRel ? draftName : displayName(node.name)}
      </span>
      {reviewCount > 0 && (
        <span
          title={`未解決のコメント ${reviewCount} 件`}
          className="ml-auto shrink-0 rounded-full bg-[var(--mg-accent-soft)] px-1.5 text-[10.5px] font-medium text-[var(--mg-accent)]"
        >
          {reviewCount}
        </span>
      )}
    </button>
  );
});

export function FileTree() {
  const tree = useAtomValue(treeAtom);
  // 作る口を出さない場面。下書きの置き場はアプリの持ち物で、1 枚だけ開いて
  // いるときの木はそのファイルしか持たない。どちらも作ったものが出てこない。
  const draftRoot = useAtomValue(draftRelAtom) !== null;
  const sole = useAtomValue(soleAtom) !== null;
  const noAdd = draftRoot || sole;
  const filter = useAtomValue(treeFilterAtom);
  const activeFolderId = useAtomValue(activeFolderIdAtom);
  const [expandedByFolder, setExpandedByFolder] = useAtom(expandedByFolderAtom);
  const [menu, setMenu] = useState<EntryMenuState | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [rootDragOver, setRootDragOver] = useState(false);
  const { createFile, createFolder, renameEntry, moveEntry, openFile, openInNewWindow } =
    useWorkspace();
  // コメントの数はここで 1 回だけ購読して下へ渡す。
  //
  // 「いま出しているファイル」は**渡さない**。ctx に入れると選択が変わる
  // たびに ctx の識別が変わり、行の memo が素通りして全行が描き直される。
  // 行は自分の分（isShownAtom）だけを購読する。
  const counts = useAtomValue(openCountsAtom);
  const filtered = useMemo(() => filterTree(tree, filter), [tree, filter]);

  // 初回は畳んだ状態で出す。1,000 ファイル規模のフォルダで最上位を全部
  // 開くと、最初の描画で数百行を一度に組むことになり画面が固まる。
  useEffect(() => {
    if (!activeFolderId || tree.length === 0) return;
    if (activeFolderId in expandedByFolder) return;
    setExpandedByFolder((prev) => ({ ...prev, [activeFolderId]: [] }));
  }, [activeFolderId, tree, expandedByFolder, setExpandedByFolder]);

  const expanded = useMemo(
    () =>
      new Set(activeFolderId ? (expandedByFolder[activeFolderId] ?? []) : []),
    [expandedByFolder, activeFolderId],
  );

  const setExpandedOpen = useCallback(
    (path: string) => {
      if (!activeFolderId) return;
      setExpandedByFolder((prev) => {
        const set = new Set(prev[activeFolderId] ?? []);
        set.add(path);
        return { ...prev, [activeFolderId]: [...set] };
      });
    },
    [activeFolderId, setExpandedByFolder],
  );

  const toggle = useCallback(
    (path: string) => {
      if (!activeFolderId) return;
      setExpandedByFolder((prev) => {
        const set = new Set(prev[activeFolderId] ?? []);
        if (set.has(path)) set.delete(path);
        else set.add(path);
        return { ...prev, [activeFolderId]: [...set] };
      });
    },
    [activeFolderId, setExpandedByFolder],
  );

  // パンくず等からの「ツリーで表示」: 祖先を展開し、対象行へスクロール＋強調
  const listRef = useRef<HTMLDivElement>(null);
  const reveal = useAtomValue(revealInTreeAtom);
  useEffect(() => {
    if (!reveal || !activeFolderId) return;
    const target = reveal.path;
    const ancestors = ancestorPaths(target);
    if (ancestors.length) {
      setExpandedByFolder((prev) => {
        const set = new Set(prev[activeFolderId] ?? []);
        ancestors.forEach((a) => set.add(a));
        return { ...prev, [activeFolderId]: [...set] };
      });
    }
    // 名前の変更に入るときは入力欄が行と入れ替わる。探す相手が居なくなるので、
    // スクロールと強調は行わない（入力欄が焦点を取って見える位置まで動く）。
    if (reveal.edit) {
      setEditingPath(target);
      return;
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

  const startCreate = useCallback(
    (parentPath: string, kind: "file" | "dir") => {
      if (parentPath) setExpandedOpen(parentPath);
      setCreating({ parentPath, kind });
    },
    [setExpandedOpen],
  );

  // 行へ渡す道具。**識別を保つのが肝**。毎回作り直すと行の memo が素通りして、
  // 選択が変わるたびに全行が描き直される（実測で 1000 行 200ms）。
  const ctx: ItemCtx = useMemo(
    () => ({
      expanded,
      filtering: !!filter,
      counts,
      openFile,
      openInNewWindow,
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
    }),
    [
      expanded,
      filter,
      counts,
      openFile,
      openInNewWindow,
      toggle,
      editingPath,
      creating,
      dragOverPath,
      renameEntry,
      createFile,
      createFolder,
      moveEntry,
      startCreate,
    ],
  );

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
        {!noAdd && (
          <>
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
          </>
        )}
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
        <EntryMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onNewFile={noAdd ? undefined : (n) => startCreate(n.path, "file")}
          onNewFolder={noAdd ? undefined : (n) => startCreate(n.path, "dir")}
          onRename={(n) => setEditingPath(n.path)}
        />
      )}
    </div>
  );
}
