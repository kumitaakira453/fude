import { useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  childrenAt,
  displayName,
  filterTree,
  parentPath,
  type TreeNode,
} from "../lib/fsAccess";
import { revealInTree } from "../lib/ui";
import { treeAtom } from "../state/atoms";
import { Icon } from "./Icon";

// ヘッダーの道筋。区切りを押すと、その階層がツリーとして開く。
// 根は押した区切りの 1 つ上。兄弟のファイルへそのまま移れる。

// メニューの幅。位置を内側へ寄せるときにも使う。
const WIDTH = 300;

interface Row {
  node: TreeNode;
  depth: number;
}

// 開いているフォルダだけを辿って、画面に出す行に潰す。
function rowsOf(
  nodes: TreeNode[],
  open: (path: string) => boolean,
  depth = 0,
): Row[] {
  const out: Row[] = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.kind === "dir" && n.children && open(n.path)) {
      out.push(...rowsOf(n.children, open, depth + 1));
    }
  }
  return out;
}

export function Breadcrumbs({
  path,
  paneId,
}: {
  path: string | null;
  paneId: string;
}) {
  const store = useStore();
  const tree = useAtomValue(treeAtom);
  const { openFile } = useWorkspace();
  const navRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 開いている階層メニュー。index は道筋の何番目を押したか。
  const [picker, setPicker] = useState<{
    index: number;
    left: number;
    top: number;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // キーで動かした位置。null なら押した区切り自身を選んでいる。
  const [cursor, setCursor] = useState<number | null>(null);
  const ime = useImeSafeEnter();

  const segs = path ? path.split("/") : [];
  const target = picker ? segs.slice(0, picker.index + 1).join("/") : "";
  const roots = useMemo(
    () => (picker ? childrenAt(tree, parentPath(target)) : []),
    [picker, tree, target],
  );
  const filtered = useMemo(() => filterTree(roots, query), [roots, query]);
  // 絞り込み中は全部開いた状態で出す。奥にある一致が隠れないようにする。
  const rows = useMemo(
    () => rowsOf(filtered, (p) => (query ? true : expanded.has(p))),
    [filtered, query, expanded],
  );

  const close = () => {
    setPicker(null);
    setQuery("");
  };

  const open = (index: number, at: HTMLElement) => {
    const box = at.getBoundingClientRect();
    const seg = segs.slice(0, index + 1).join("/");
    const isDir = index < segs.length - 1;
    setPicker({
      index,
      left: Math.min(box.left, window.innerWidth - WIDTH - 8),
      top: box.bottom + 4,
    });
    setQuery("");
    // 押した区切りがフォルダなら、その中身を開いた状態で出す。
    setExpanded(new Set(isDir ? [seg] : []));
    setCursor(null);
  };

  // メニューの外を押したら閉じる。道筋の中は同じ区切りの押し直しで畳めるよう素通しする。
  useEffect(() => {
    if (!picker) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (navRef.current?.contains(t)) return;
      close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
    };
  }, [picker]);

  // 選んでいる行は常に範囲内に収める。絞り込みで行数が減っても壊れない。
  const hereAt = rows.findIndex((r) => r.node.path === target);
  const at =
    cursor === null
      ? Math.max(0, hereAt)
      : Math.min(cursor, Math.max(0, rows.length - 1));
  const current = rows[at]?.node;

  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const activate = (node: TreeNode) => {
    if (node.kind === "dir") {
      toggle(node.path);
      // 行を押すと焦点がそこへ移る。戻さないと続けて絞り込みが打てない。
      inputRef.current?.focus();
    } else {
      openFile(node.path, paneId);
      close();
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    // 変換中の Enter は絞り込みの確定。行を開く合図として扱わない。
    if (ime.isComposing(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(Math.min(at + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(Math.max(at - 1, 0));
    } else if (e.key === "ArrowRight") {
      if (current?.kind === "dir" && !expanded.has(current.path)) {
        e.preventDefault();
        toggle(current.path);
      }
    } else if (e.key === "ArrowLeft") {
      if (current?.kind === "dir" && expanded.has(current.path)) {
        e.preventDefault();
        toggle(current.path);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (current) activate(current);
    }
  };

  if (!path) return <span>ファイル未選択</span>;

  return (
    <>
      <div ref={navRef} className="truncate">
        {segs.map((seg, i, arr) => (
          <span key={i}>
            {i > 0 && <span className="mx-1.5 opacity-60">›</span>}
            <button
              onClick={(e) =>
                picker?.index === i ? close() : open(i, e.currentTarget)
              }
              title={arr.slice(0, i + 1).join("/")}
              className={`rounded px-0.5 hover:text-[var(--mg-accent)] hover:underline ${
                picker?.index === i ? "text-[var(--mg-accent)]" : ""
              }`}
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {picker &&
        createPortal(
          <div
            ref={popRef}
            style={{ left: picker.left, top: picker.top, width: WIDTH }}
            onKeyDown={onKey}
            className="mg-crumb-pop fixed z-50 flex flex-col rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] p-1.5 shadow-2xl"
          >
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onCompositionStart={ime.onCompositionStart}
              onCompositionEnd={ime.onCompositionEnd}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(null);
              }}
              placeholder="絞り込み"
              className="mb-1 shrink-0 rounded-lg border border-[var(--mg-border)] bg-[var(--mg-input-bg)] px-2 py-1 text-[12.5px] outline-none focus:border-[var(--mg-accent)]"
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {rows.length === 0 ? (
                <div className="px-2 py-6 text-center text-[12px] text-[var(--mg-muted)]">
                  一致するファイルがありません
                </div>
              ) : (
                rows.map(({ node, depth }, i) => (
                  <PickerRow
                    key={node.path}
                    node={node}
                    depth={depth}
                    open={query ? true : expanded.has(node.path)}
                    here={node.path === target}
                    hovered={i === at}
                    onEnter={() => setCursor(i)}
                    onPick={() => activate(node)}
                  />
                ))
              )}
            </div>
            <div className="mt-1 shrink-0 border-t border-[var(--mg-border)] pt-1">
              <button
                onClick={() => {
                  revealInTree(store, target);
                  close();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[var(--mg-fg-dim)] transition hover:bg-[var(--mg-hover)]"
              >
                <Icon
                  name="account_tree"
                  size={16}
                  className="text-[var(--mg-muted)]"
                />
                ツリーで表示
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function PickerRow({
  node,
  depth,
  open,
  here,
  hovered,
  onEnter,
  onPick,
}: {
  node: TreeNode;
  depth: number;
  open: boolean;
  here: boolean;
  hovered: boolean;
  onEnter: () => void;
  onPick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // キーで辿ったときに、選んでいる行を隠れたままにしない。
  useEffect(() => {
    if (hovered) ref.current?.scrollIntoView({ block: "nearest" });
  }, [hovered]);

  const dir = node.kind === "dir";
  return (
    <button
      ref={ref}
      onMouseEnter={onEnter}
      onClick={onPick}
      style={{ paddingLeft: `${depth * 14 + 6}px` }}
      className={`flex h-7 w-full items-center gap-1 rounded-md pr-2 text-left text-[13px] transition ${
        here
          ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)]"
          : hovered
            ? "bg-[var(--mg-hover)] text-[var(--mg-fg-dim)]"
            : "text-[var(--mg-fg-dim)]"
      }`}
    >
      {dir ? (
        <Icon
          name="chevron_right"
          size={18}
          className={`shrink-0 text-[var(--mg-muted)] transition-transform duration-150 ${
            open ? "rotate-90" : ""
          }`}
        />
      ) : (
        <span className="w-[18px] shrink-0" />
      )}
      <Icon
        name={dir ? (open ? "folder_open" : "folder") : "markdown"}
        size={dir ? 17 : 16}
        fill={dir || here}
        className={
          dir
            ? "shrink-0 text-[var(--mg-accent2)]"
            : here
              ? "shrink-0 text-[var(--mg-accent)]"
              : "shrink-0 text-[var(--mg-muted)]"
        }
      />
      <span className={`truncate ${dir ? "font-medium" : ""}`}>
        {dir ? node.name : displayName(node.name)}
      </span>
    </button>
  );
}
