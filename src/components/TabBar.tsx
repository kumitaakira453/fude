import { useAtomValue, useStore } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useDragReset } from "../hooks/useDragReset";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  dropPoint,
  droppedOutside,
  readDragPayload,
  setDragPayload,
} from "../lib/dnd";
import { setDragChip } from "../lib/dragImage";
import { displayName, findNode, type TreeNode } from "../lib/fsAccess";
import {
  activateTab,
  closeOthers,
  closeTab,
  closeTabAt,
  moveTab,
  openInPane,
  revealInTree,
} from "../lib/ui";
import { type LeafNode, treeAtom } from "../state/atoms";
import { draftNameAtom, draftRelAtom } from "../state/drafts";
import { EntryMenu, type EntryMenuState } from "./EntryMenu";
import { Icon } from "./Icon";

// ペインが持つタブの並び。分割の各ペインがそれぞれ持つ。
// タブは掴んで別のペインへ移せる。ファイルツリーからここへ落として開くこともできる。

export function TabBar({ pane, isActive }: { pane: LeafNode; isActive: boolean }) {
  const store = useStore();
  const { openInNewWindow, getRootPath } = useWorkspace();
  const tree = useAtomValue(treeAtom);
  const draftRel = useAtomValue(draftRelAtom);
  const draftName = useAtomValue(draftNameAtom);

  // 開いているタブを見える位置へ寄せる。数が増えると端から溢れるので、
  // 切り替えた先が隠れていると、どれを見ているのか分からなくなる。
  const here = useRef<HTMLDivElement>(null);
  const active = pane.tabs[pane.active];
  useEffect(() => {
    here.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, pane.tabs.length]);

  // タブに出す名前。下書きは置き場で採った機械的な名前を持っているので、
  // 書いた中身から採り直す。
  const label = (path: string): string =>
    path === draftRel ? draftName : displayName(path);
  // ドロップで差し込む位置。null なら受け付けていない。
  const [insertAt, setInsertAt] = useState<number | null>(null);
  // 右押しの相手。並びの中の位置も持つ（「他のタブを閉じる」が要る）。
  const [menu, setMenu] = useState<(EntryMenuState & { at: number }) | null>(null);
  useDragReset(() => setInsertAt(null));

  // 右クリックの相手。ツリーに見つからないファイルでも操作できるように組み立てる。
  const nodeFor = (path: string): TreeNode => {
    const hit = findNode(tree, path);
    if (hit) return hit;
    const root = getRootPath();
    return {
      name: path.split("/").pop() ?? path,
      path,
      abs: root ? `${root}/${path}` : path,
      kind: "file",
    };
  };

  if (pane.tabs.length === 0) return null;

  const accept = (e: React.DragEvent) =>
    e.dataTransfer.types.includes("application/x-fude-path");

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
    <>
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
              ref={selected ? here : undefined}
              data-mg-tab
              draggable
              onDragStart={(e) => {
                setDragPayload(e.dataTransfer, { path, from: { paneId: pane.id, index: i } });
                e.dataTransfer.effectAllowed = "move";
                setDragChip(e.dataTransfer, label(path));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, node: nodeFor(path), at: i });
              }}
              // ウィンドウの外へ引き出したら、そのファイルを別ウィンドウへ移す。
              // タブを消すのはウィンドウができてから。先に消すと、開くまでの間
              // どちらにも無い状態が見えてしまう。
              onDragEnd={(e) => {
                if (!droppedOutside(e)) return;
                void openInNewWindow(path, dropPoint(e)).then((opened) => {
                  // 別のウィンドウへ移しただけなので、閉じた控えには積まない
                  if (opened) closeTabAt(store, pane.id, path, { remember: false });
                });
              }}
              // 遷移は掛けない。上端のアクセントの線は要素の出現で即座に出る
              // ので、背景だけ遅れると足並みが揃わない（ツリーの行と同じ）。
              className={`group relative flex max-w-[200px] items-center gap-1 border-r border-[var(--mg-border)] pl-3 pr-1.5 text-[12px] ${
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
                title={selected ? `${path}\n押すとツリーで表示` : path}
                // 開いているタブをもう一度押すのは「ここを出して」という合図。
                // 切り替えのたびにツリーが動くと、狙って触るまで読めなくなる。
                onClick={() =>
                  selected
                    ? revealInTree(store, path)
                    : activateTab(store, pane.id, i)
                }
                // 中クリックで閉じる（タブの慣習）
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(store, pane.id, i);
                  }
                }}
                className="select-none truncate py-1.5"
              >
                {label(path)}
              </button>
              {/* 閉じるボタンは常に出す。ホバーで現れる作りだと、閉じられる
                  ことに気付けないうえ、狙って触るまで的が見えない。
                  普段は色を落として、名前より前に出ないようにする。 */}
              <button
                type="button"
                title="閉じる"
                onClick={() => closeTab(store, pane.id, i)}
                className="mg-tab-x"
              >
                <Icon name="close" size={13} />
              </button>
              {insertAt === i && <Marker side="left" />}
              {insertAt === i + 1 && <Marker side="right" />}
            </div>
          );
        })}
      </div>
      {menu && (
        <EntryMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onRename={(n) => revealInTree(store, n.path, { edit: true })}
          onCloseOthers={
            pane.tabs.length > 1
              ? () => closeOthers(store, pane.id, menu.at)
              : undefined
          }
        />
      )}
    </>
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
