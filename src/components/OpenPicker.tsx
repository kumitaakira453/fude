import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { useWorkspace } from "../hooks/useWorkspace";
import { pickDirectory } from "../lib/fsAccess";
import {
  folderDisplayName,
  removeDoc,
  removeFolder,
  renameFolder,
  type DocEntry,
} from "../lib/idb";
import { pickDocFile } from "../lib/kind";
import { ago } from "../lib/when";
import {
  activeFolderIdAtom,
  foldersAtom,
  openPickerAtom,
  recentDocsAtom,
  soleAtom,
} from "../state/atoms";
import { draftNameAtom } from "../state/drafts";
import { Icon } from "./Icon";

// 開くものを選ぶ画面。
//
// フォルダも、1 枚で開いたファイルも、行き先はここひとつ。左上のプルダウンに
// 積んでいた頃は、フォルダが増えるほど狭い枠の中を延々と送ることになり、
// 一度開いたファイルにいたっては辿る道が無かった。
//
// 中身はすべて既にあるもの（idb の履歴と useWorkspace の開き口）を並べ替えて
// 出すだけで、覚えるものは増やさない。

type Side = "folders" | "docs";
type Order = "recent" | "name";

// 名前と道筋を見る。空白で区切って、すべて含むものを当てる。
function matches(entry: DocEntry, name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${name} ${entry.path}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export function OpenPicker() {
  const [open, setOpen] = useAtom(openPickerAtom);
  const folders = useAtomValue(foldersAtom);
  const docs = useAtomValue(recentDocsAtom);
  const activeId = useAtomValue(activeFolderIdAtom);
  const sole = useAtomValue(soleAtom);
  const draftName = useAtomValue(draftNameAtom);
  const setFolders = useSetAtom(foldersAtom);
  const setDocs = useSetAtom(recentDocsAtom);
  const { openFolder, openDoc, openFolderInNewWindow, refreshFolders, holdDraft } =
    useWorkspace();

  const [side, setSide] = useState<Side>("folders");
  const [order, setOrder] = useState<Order>("recent");
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const ime = useImeSafeEnter();

  // 開き直すたびに素の状態から。前に打った字が残っていると、開いた瞬間に
  // 何も出ていないように見える。
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setAt(0);
    setEditingId(null);
    setSide(sole ? "docs" : "folders");
  }, [open, sole]);

  const name = (e: DocEntry) => (side === "folders" ? folderDisplayName(e) : e.name);

  const rows = useMemo(() => {
    const list = (side === "folders" ? folders : docs).filter((e) =>
      matches(e, side === "folders" ? folderDisplayName(e) : e.name, query),
    );
    return [...list].sort((a, b) =>
      order === "recent"
        ? b.lastOpened - a.lastOpened
        : (side === "folders" ? folderDisplayName(a) : a.name).localeCompare(
            side === "folders" ? folderDisplayName(b) : b.name,
            "ja",
          ),
    );
  }, [side, folders, docs, query, order]);

  // 当たりが減ったときに、選びが並びの外へ出たままにならないようにする。
  useEffect(() => setAt((i) => Math.min(i, Math.max(0, rows.length - 1))), [rows.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${at}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [at]);

  if (!open) return null;

  const choose = async (entry: DocEntry | undefined) => {
    if (!entry) return;
    setOpen(false);
    if (side === "folders") await openFolder(entry.path);
    else await openDoc(entry.path);
  };

  // 下書きのままなら、選ぶ前に行き先を決めさせる。OS のダイアログを開いてから
  // 引き止めると、選んだのに何も起きなかったように見える。
  const addFolder = async () => {
    setOpen(false);
    if (holdDraft(() => void addFolder())) return;
    const path = await pickDirectory();
    if (path) await openFolder(path);
  };

  const addDoc = async () => {
    setOpen(false);
    if (holdDraft(() => void addDoc())) return;
    const path = await pickDocFile();
    if (path) await openDoc(path);
  };

  const forget = async (entry: DocEntry) => {
    if (side === "folders") {
      await removeFolder(entry.id);
      await refreshFolders();
    } else {
      setDocs(await removeDoc(entry.id));
    }
  };

  const commitRename = async (id: string) => {
    setFolders(await renameFolder(id, alias));
    setEditingId(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="mg-open flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--mg-border)] bg-[var(--mg-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--mg-border)] px-4">
          <Icon name="folder_open" size={20} className="shrink-0 text-[var(--mg-accent)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyUp={ime.onKeyUp}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(e) => {
              if (ime.isComposing(e)) return; // IME 変換中のキーを無視
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt((i) => Math.min(i + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                void choose(rows[at]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="開く…（名前と道筋で絞り込み）"
            className="w-full bg-transparent py-3 text-[15px] outline-none placeholder:text-[var(--mg-muted)]"
          />
        </div>

        {(draftName || sole) && (
          <div className="mg-open-note">
            <Icon
              name={draftName ? "edit_note" : "description"}
              size={15}
              className="shrink-0 text-[var(--mg-accent)]"
            />
            <span className="truncate">
              {draftName ? "保存先はまだ決まっていません" : "1 枚だけ開いています"}
            </span>
            {!draftName && activeId && (
              <button
                onClick={() => {
                  setOpen(false);
                  void openFolder(activeId);
                }}
                className="ml-auto shrink-0 font-medium text-[var(--mg-accent)] transition hover:opacity-80"
              >
                このフォルダを開く
              </button>
            )}
          </div>
        )}

        <div className="mg-open-bar">
          <div className="mg-rail-pick">
            <button
              type="button"
              onClick={() => setSide("folders")}
              className={side === "folders" ? "is-on" : ""}
            >
              フォルダ {folders.length}
            </button>
            <button
              type="button"
              onClick={() => setSide("docs")}
              className={side === "docs" ? "is-on" : ""}
            >
              ファイル {docs.length}
            </button>
          </div>
          <div className="mg-rail-pick ml-auto">
            <button
              type="button"
              onClick={() => setOrder("recent")}
              className={order === "recent" ? "is-on" : ""}
            >
              新しい順
            </button>
            <button
              type="button"
              onClick={() => setOrder("name")}
              className={order === "name" ? "is-on" : ""}
            >
              名前順
            </button>
          </div>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {rows.map((entry, i) => (
            <div
              key={entry.id}
              data-idx={i}
              onMouseMove={() => setAt(i)}
              onClick={() => editingId !== entry.id && void choose(entry)}
              className={`mg-open-row${i === at ? " is-at" : ""}${
                entry.id === activeId && side === "folders" ? " is-now" : ""
              }`}
            >
              <Icon
                name={side === "folders" ? "folder" : "description"}
                size={16}
                className="shrink-0 text-[var(--mg-muted)]"
              />
              {editingId === entry.id ? (
                <input
                  autoFocus
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyUp={ime.onKeyUp}
                  onCompositionStart={ime.onCompositionStart}
                  onCompositionEnd={ime.onCompositionEnd}
                  onKeyDown={(e) => {
                    if (ime.isComposing(e)) return;
                    if (e.key === "Enter") void commitRename(entry.id);
                    else if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => void commitRename(entry.id)}
                  placeholder={entry.name}
                  className="min-w-0 flex-1 rounded border border-[var(--mg-accent)] bg-[var(--mg-input-bg)] px-1 py-0.5 text-[13px] outline-none"
                />
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-[var(--mg-fg)]">
                      {name(entry)}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--mg-muted)]">
                      {entry.path}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10.5px] text-[var(--mg-muted)]">
                    {ago(entry.lastOpened)}
                  </span>
                  <span className="mg-open-acts">
                    {side === "folders" && (
                      <>
                        <Act
                          icon="open_in_new"
                          label="新しいウィンドウで開く"
                          run={() => {
                            void openFolderInNewWindow(entry.id, folderDisplayName(entry));
                          }}
                        />
                        <Act
                          icon="edit"
                          label="表示名を変更"
                          run={() => {
                            setEditingId(entry.id);
                            setAlias(folderDisplayName(entry));
                          }}
                        />
                      </>
                    )}
                    <Act
                      icon="close"
                      label="履歴から削除"
                      run={() => void forget(entry)}
                    />
                  </span>
                </>
              )}
            </div>
          ))}
          {rows.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-[var(--mg-muted)]">
              {query
                ? "見つかりません"
                : side === "folders"
                  ? "登録したフォルダはまだありません"
                  : "1 枚で開いたファイルはまだありません"}
            </div>
          )}
        </div>

        <div className="flex gap-1 border-t border-[var(--mg-border)] p-1.5">
          <button onClick={addFolder} className="mg-switch-open">
            <Icon name="folder_open" size={16} />
            フォルダを開く…
          </button>
          <button onClick={addDoc} className="mg-switch-open">
            <Icon name="description" size={16} />
            ファイルを開く…
          </button>
        </div>
      </div>
    </div>
  );
}

function Act({
  icon,
  label,
  run,
}: {
  icon: string;
  label: string;
  run: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        run();
      }}
      className="grid h-5 w-5 place-items-center rounded text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-accent)]"
    >
      <Icon name={icon} size={14} />
    </button>
  );
}
