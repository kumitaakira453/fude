import { useAtomValue, useStore } from "jotai";
import { useMemo } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import { displayName, pathExists, pickDirectory, pickMarkdownFile } from "../lib/fsAccess";
import { folderDisplayName, removeDoc } from "../lib/idb";
import { isOpen } from "../lib/review";
import { foldersAtom, recentDocsAtom } from "../state/atoms";
import { ledgerAtom } from "../state/review";
import { notify } from "../state/toast";
import { Icon } from "./Icon";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "たった今";
  if (m < 60) return `${m} 分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 時間前`;
  return `${Math.floor(h / 24)} 日前`;
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "P"], label: "クイックオープン" },
  { keys: ["⌘", "⇧", "F"], label: "全文検索" },
  { keys: ["⌘", "B"], label: "サイドバー表示切替" },
  { keys: ["⌘", "\\"], label: "右に分割" },
  { keys: ["Esc"], label: "閉じる" },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid min-w-[1.4rem] place-items-center rounded-md border border-[var(--mg-border)] bg-[var(--mg-panel)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--mg-fg-dim)] shadow-sm">
      {children}
    </kbd>
  );
}

export function Landing() {
  const store = useStore();
  const folders = useAtomValue(foldersAtom);
  const docs = useAtomValue(recentDocsAtom);
  const ledger = useAtomValue(ledgerAtom);
  const { openFolder, openDoc, refreshFolders } = useWorkspace();

  // フォルダごとの未解決の指摘の数。台帳は絶対パスで持っているので、
  // フォルダの道筋で前方一致を数える。開く前に「読むものがある」と
  // 分かると、どのフォルダに戻ればよいかを迷わない。
  const counts = useMemo(() => {
    const open = ledger.threads.filter(isOpen);
    const map = new Map<string, number>();
    for (const folder of folders) {
      const prefix = `${folder.path}/`;
      map.set(
        folder.id,
        open.reduce((n, t) => n + (t.file.startsWith(prefix) ? 1 : 0), 0),
      );
    }
    return map;
  }, [ledger, folders]);

  const open = async () => {
    const path = await pickDirectory();
    if (path) await openFolder(path);
  };

  const openOne = async () => {
    const path = await pickMarkdownFile();
    if (path) await openDoc(path);
  };

  // 履歴から開き直す。実体が無ければ黙って何もせず、一覧から落とす。
  const reopen = async (id: string, path: string) => {
    if (await pathExists(path)) {
      await openDoc(path);
      return;
    }
    await removeDoc(id);
    await refreshFolders();
    notify(store, "そのファイルはもうありません");
  };

  return (
    <div className="mg-landing h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center px-8 py-12">
        <div className="mb-10 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)]">
            <Icon
              name="auto_awesome"
              size={22}
              className="text-[var(--mg-accent)]"
            />
          </div>
          <div>
            <h1 className="text-[1.7rem] font-semibold leading-tight tracking-[-0.02em] text-[var(--mg-fg)]">
              fude
            </h1>
            <p className="text-[13px] text-[var(--mg-muted)]">
              ローカルの Markdown を、美しく読む
            </p>
          </div>
        </div>

        <div className="grid gap-x-12 gap-y-8 md:grid-cols-2">
          <div>
            <SectionTitle>スタート</SectionTitle>
            <div className="mt-1">
              <button
                onClick={open}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[14px] text-[var(--mg-accent)] transition hover:bg-[var(--mg-hover)]"
              >
                <Icon name="folder_open" size={19} />
                <span className="font-medium">フォルダを開く…</span>
              </button>
              <button
                onClick={openOne}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[14px] text-[var(--mg-accent)] transition hover:bg-[var(--mg-hover)]"
              >
                <Icon name="description" size={19} />
                <span className="font-medium">Markdown ファイルを開く…</span>
              </button>
            </div>

            {docs.length > 0 && (
              <>
                <SectionTitle className="mt-8">最近のファイル</SectionTitle>
                <div className="mt-1">
                  {docs.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => reopen(d.id, d.path)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--mg-hover)]"
                    >
                      <Icon
                        name="description"
                        size={17}
                        className="shrink-0 text-[var(--mg-muted)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-[13.5px] font-medium text-[var(--mg-fg-dim)]"
                          title={d.path}
                        >
                          {displayName(d.name)}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--mg-muted)]">
                          {folderOf(d.path)}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--mg-muted)]">
                        {timeAgo(d.lastOpened)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <SectionTitle className="mt-8">最近のフォルダ</SectionTitle>
            <div className="mt-1">
              {folders.length === 0 ? (
                <p className="px-2 py-2 text-[13px] text-[var(--mg-muted)]">
                  履歴はまだありません
                </p>
              ) : (
                folders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => openFolder(f.path)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--mg-hover)]"
                  >
                    <Icon
                      name="folder"
                      size={17}
                      className="shrink-0 text-[var(--mg-muted)]"
                    />
                    <span
                      className="truncate text-[13.5px] font-medium text-[var(--mg-fg-dim)]"
                      title={f.path}
                    >
                      {folderDisplayName(f)}
                    </span>
                    {(counts.get(f.id) ?? 0) > 0 && (
                      <span
                        className="mg-landing-count"
                        title={`未解決のコメント ${counts.get(f.id)} 件`}
                      >
                        <Icon name="chat_bubble" size={11} fill />
                        {counts.get(f.id)}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] text-[var(--mg-muted)]">
                      {timeAgo(f.lastOpened)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div>
            <SectionTitle>ショートカット</SectionTitle>
            <div className="mt-2 space-y-1.5">
              {SHORTCUTS.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-2 px-2 text-[13px]"
                >
                  <div className="flex gap-1">
                    {s.keys.map((k, i) => (
                      <Kbd key={i}>{k}</Kbd>
                    ))}
                  </div>
                  <span className="text-[var(--mg-muted)]">{s.label}</span>
                </div>
              ))}
            </div>

            <SectionTitle className="mt-8">補足</SectionTitle>
            <p className="mt-2 flex items-start gap-2 px-2 text-[12.5px] leading-relaxed text-[var(--mg-muted)]">
              <Icon
                name="lock"
                size={15}
                className="mt-0.5 shrink-0 text-[var(--mg-accent)]"
              />
              すべての読み込みは端末内で完結します。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// 道筋のうち、親フォルダの名前だけ。どのフォルダの 1 枚かが分かればよい。
function folderOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 2] ?? path;
}

function SectionTitle({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--mg-muted)] ${className}`}
    >
      {children}
    </h2>
  );
}
