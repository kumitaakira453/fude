import { useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { activeFolderIdAtom, foldersAtom, soleAtom } from "../state/atoms";
import { displayName, pickDirectory, pickMarkdownFile } from "../lib/fsAccess";
import { folderDisplayName, removeFolder, renameFolder } from "../lib/idb";
import { useWorkspace } from "../hooks/useWorkspace";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { Icon } from "./Icon";

export function FolderSwitcher() {
  const folders = useAtomValue(foldersAtom);
  const setFolders = useSetAtom(foldersAtom);
  const activeId = useAtomValue(activeFolderIdAtom);
  const sole = useAtomValue(soleAtom);
  const { openFolder, openDoc, openFolderInNewWindow, refreshFolders } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const ime = useImeSafeEnter();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const active = folders.find((f) => f.id === activeId);

  // 開いているフォルダは openFolder が控えを読んだ後に切り替える。ここで先に
  // 切り替えると、前のフォルダのレイアウトが新しいフォルダの控えを潰す。
  const switchTo = async (id: string) => {
    const entry = folders.find((f) => f.id === id);
    if (!entry) return;
    setOpen(false);
    await openFolder(entry.path);
  };

  const addFolder = async () => {
    setOpen(false);
    const path = await pickDirectory();
    if (path) await openFolder(path);
  };

  const addDoc = async () => {
    setOpen(false);
    const path = await pickMarkdownFile();
    if (path) await openDoc(path);
  };

  // 1 枚で開いているファイルの、そのフォルダをふつうに開く。
  const openHome = async () => {
    if (!activeId) return;
    setOpen(false);
    await openFolder(activeId);
  };

  const remove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await removeFolder(id);
    await refreshFolders();
  };

  const startRename = (e: React.MouseEvent, id: string, current: string) => {
    e.stopPropagation();
    setEditingId(id);
    setDraft(current);
  };

  const commitRename = async (id: string) => {
    const next = await renameFolder(id, draft);
    setFolders(next);
    setEditingId(null);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--mg-hover)]"
      >
        <Icon
          name={sole ? "description" : "folder"}
          size={18}
          fill
          className="text-[var(--mg-accent2)]"
        />
        <span
          className="truncate text-[13px] font-semibold text-[var(--mg-fg)]"
          title={sole ?? undefined}
        >
          {sole ? displayName(sole) : active ? folderDisplayName(active) : "フォルダ"}
        </span>
        <Icon name="unfold_more" size={17} className="ml-auto text-[var(--mg-muted)]" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] p-1.5 shadow-2xl">
          <div className="mb-1 px-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
            登録フォルダ
          </div>
          <div className="max-h-72 overflow-y-auto">
            {folders.map((f) => {
              const editing = editingId === f.id;
              return (
                <div
                  key={f.id}
                  onClick={() => !editing && switchTo(f.id)}
                  className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition ${
                    editing ? "" : "cursor-pointer"
                  } ${f.id === activeId ? "bg-[var(--mg-accent-soft)]" : "hover:bg-[var(--mg-hover)]"}`}
                >
                  <Icon name="folder" size={16} className="shrink-0 text-[var(--mg-muted)]" />
                  {editing ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onCompositionStart={ime.onCompositionStart}
                      onCompositionEnd={ime.onCompositionEnd}
                      onKeyDown={(e) => {
                        if (ime.isComposing(e)) return; // IME 変換確定の Enter を無視
                        if (e.key === "Enter") void commitRename(f.id);
                        else if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => void commitRename(f.id)}
                      placeholder={f.name}
                      className="min-w-0 flex-1 rounded border border-[var(--mg-accent)] bg-[var(--mg-input-bg)] px-1 py-0.5 text-[13px] outline-none"
                    />
                  ) : (
                    <>
                      <span className="truncate text-[13px]" title={f.path}>
                        {folderDisplayName(f)}
                      </span>
                      <div className="ml-auto flex shrink-0 items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void openFolderInNewWindow(f.id, folderDisplayName(f));
                          }}
                          title="新しいウィンドウで開く"
                          className="grid h-5 w-5 place-items-center rounded text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-accent)]"
                        >
                          <Icon name="open_in_new" size={14} />
                        </button>
                        <button
                          onClick={(e) => startRename(e, f.id, folderDisplayName(f))}
                          title="表示名を変更"
                          className="grid h-5 w-5 place-items-center rounded text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-accent)]"
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        <button
                          onClick={(e) => remove(e, f.id)}
                          title="履歴から削除"
                          className="grid h-5 w-5 place-items-center rounded text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-danger)]"
                        >
                          <Icon name="close" size={15} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="my-1 h-px bg-[var(--mg-border)]" />
          {sole && (
            <button
              onClick={openHome}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-[var(--mg-accent)] transition hover:bg-[var(--mg-hover)]"
            >
              <Icon name="folder_open" size={17} />
              このファイルのフォルダを開く
            </button>
          )}
          <button
            onClick={addDoc}
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-[var(--mg-accent)] transition hover:bg-[var(--mg-hover)]"
          >
            <Icon name="description" size={17} />
            Markdown ファイルを開く…
          </button>
          <button
            onClick={addFolder}
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-[var(--mg-accent)] transition hover:bg-[var(--mg-hover)]"
          >
            <Icon name="create_new_folder" size={17} />
            フォルダを追加
          </button>
        </div>
      )}
    </div>
  );
}
