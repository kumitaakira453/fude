import { confirm as dialogConfirm } from "@tauri-apps/plugin-dialog";
import { useStore } from "jotai";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  availableApps,
  type ExternalApp,
  openWith,
  revealInFinder,
} from "../lib/external";
import type { TreeNode } from "../lib/fsAccess";
import { openToSide } from "../lib/ui";
import { Icon } from "./Icon";

// ファイル・フォルダに対する操作の一覧。ファイルツリーの行と、開いているタブの
// どちらからも同じ中身を出す。
// 名前の変更だけは呼び出し側で入り方が違う（ツリーはその場、タブはツリーを開いてから）。

export interface EntryMenuState {
  x: number;
  y: number;
  node: TreeNode;
}

export function EntryMenu({
  menu,
  onClose,
  onRename,
  onNewFile,
  onNewFolder,
}: {
  menu: EntryMenuState;
  onClose: () => void;
  onRename: (n: TreeNode) => void;
  onNewFile?: (n: TreeNode) => void;
  onNewFolder?: (n: TreeNode) => void;
}) {
  const { openInNewWindow, getRootPath, deleteEntry } = useWorkspace();
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

  const askDelete = async () => {
    const ok = await dialogConfirm(
      `「${node.name}」を削除しますか？${node.kind === "dir" ? "\n中身ごと削除されます。" : ""}`,
      { title: "削除の確認", kind: "warning" },
    );
    if (ok) void deleteEntry(node.path, node.kind === "dir");
  };

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
      action: () => void askDelete(),
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
            icon: "vertical_split",
            label: "横に開く",
            action: () => openToSide(store, node.path),
          },
          {
            icon: "open_in_new",
            label: "新しいウィンドウで開く",
            action: () => void openInNewWindow(node.path),
          },
          ...commonItems,
        ]
      : [
          ...(onNewFile
            ? [
                {
                  icon: "note_add",
                  label: "新規ファイル",
                  action: () => onNewFile(node),
                } satisfies MI,
              ]
            : []),
          ...(onNewFolder
            ? [
                {
                  icon: "create_new_folder",
                  label: "新規フォルダ",
                  action: () => onNewFolder(node),
                } satisfies MI,
              ]
            : []),
          ...commonItems,
        ];

  const rows = items.length;
  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 220),
    top: Math.min(menu.y, window.innerHeight - (rows * 30 + 16)),
  };

  // ぼかしを掛けた枠の中に置くと fixed の基準がそこになる。body へ出して逃がす。
  return createPortal(
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
    </div>,
    document.body,
  );
}
