import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { activeFolderIdAtom, foldersAtom } from "../state/atoms";
import { pickDirectory } from "../lib/fsAccess";
import { removeFolder } from "../lib/idb";
import { useWorkspace } from "../hooks/useWorkspace";
import { Icon } from "./Icon";

export function FolderSwitcher() {
  const folders = useAtomValue(foldersAtom);
  const [activeId, setActiveId] = useAtom(activeFolderIdAtom);
  const { openFolder, refreshFolders } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const active = folders.find((f) => f.id === activeId);

  const switchTo = async (id: string) => {
    const entry = folders.find((f) => f.id === id);
    if (!entry) return;
    setOpen(false);
    setActiveId(id);
    await openFolder(entry.path);
  };

  const addFolder = async () => {
    setOpen(false);
    const path = await pickDirectory();
    if (path) await openFolder(path);
  };

  const remove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await removeFolder(id);
    await refreshFolders();
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--mg-hover)]"
      >
        <Icon name="folder" size={18} fill className="text-[var(--mg-accent2)]" />
        <span className="truncate text-[13px] font-semibold text-[var(--mg-fg)]">
          {active?.name ?? "フォルダ"}
        </span>
        <Icon name="unfold_more" size={17} className="ml-auto text-[var(--mg-muted)]" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] p-1.5 shadow-2xl">
          <div className="mb-1 px-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--mg-muted)]">
            登録フォルダ
          </div>
          <div className="max-h-64 overflow-y-auto">
            {folders.map((f) => (
              <div
                key={f.id}
                onClick={() => switchTo(f.id)}
                className={`group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 transition ${
                  f.id === activeId ? "bg-[var(--mg-accent-soft)]" : "hover:bg-[var(--mg-hover)]"
                }`}
              >
                <Icon name="folder" size={16} className="shrink-0 text-[var(--mg-muted)]" />
                <span className="truncate text-[13px]">{f.name}</span>
                <button
                  onClick={(e) => remove(e, f.id)}
                  title="履歴から削除"
                  className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-danger)]"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="my-1 h-px bg-[var(--mg-border)]" />
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
