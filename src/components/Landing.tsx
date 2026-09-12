import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import { displayName, pickDirectory, pickMarkdownFile } from "../lib/fsAccess";
import { folderDisplayName } from "../lib/idb";
import { isOpen } from "../lib/review";
import { foldersAtom, recentDocsAtom } from "../state/atoms";
import { ledgerAtom } from "../state/review";
import { AppIcon } from "./AppIcon";
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

// 道筋のうち、親フォルダの名前だけ。どこの 1 枚かが分かればよい。
function folderOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 2] ?? "";
}

interface Recent {
  kind: "folder" | "file";
  id: string;
  name: string;
  where: string;
  path: string;
  lastOpened: number;
  open: number;
}

export function Landing() {
  const folders = useAtomValue(foldersAtom);
  const docs = useAtomValue(recentDocsAtom);
  const ledger = useAtomValue(ledgerAtom);
  const { openFolder, openDoc } = useWorkspace();

  // フォルダと 1 枚のファイルを 1 本にまとめて、新しい順に並べる。
  // 戻るときに思い出すのは種類ではなく「最後に何を見ていたか」なので、
  // 一覧を 2 つに割らない。
  const recent = useMemo<Recent[]>(() => {
    const open = ledger.threads.filter(isOpen);
    const rows: Recent[] = [
      ...folders.map((f) => ({
        kind: "folder" as const,
        id: f.id,
        name: folderDisplayName(f),
        where: "",
        path: f.path,
        lastOpened: f.lastOpened,
        // 開く前に「読むものがある」と分かると、どこへ戻るか迷わない。
        open: open.reduce((n, t) => n + (t.file.startsWith(`${f.path}/`) ? 1 : 0), 0),
      })),
      ...docs.map((d) => ({
        kind: "file" as const,
        id: d.id,
        name: displayName(d.name),
        where: folderOf(d.path),
        path: d.path,
        lastOpened: d.lastOpened,
        open: open.reduce((n, t) => n + (t.file === d.path ? 1 : 0), 0),
      })),
    ];
    return rows.sort((a, b) => b.lastOpened - a.lastOpened);
  }, [folders, docs, ledger]);

  const pickFolder = async () => {
    const path = await pickDirectory();
    if (path) await openFolder(path);
  };

  const pickFile = async () => {
    const path = await pickMarkdownFile();
    if (path) openDoc(path);
  };

  return (
    <div className="mg-landing relative h-full overflow-hidden">
      {/* 地の色をゆっくり動かす。読むものが無い画面なので、ここだけ息をさせる。
          画面の外へはみ出す円なので、切り取る層に入れる。 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="mg-blob mg-blob-a" />
        <div className="mg-blob mg-blob-b" />
      </div>

      <div className="relative mx-auto flex h-full max-w-2xl flex-col justify-center px-8 py-16">
        <div className="mg-mark mb-12 flex shrink-0 items-center gap-4">
          <AppIcon size={58} className="mg-mark-icon text-[var(--mg-accent)]" />
          <div>
            <h1 className="mg-wordmark text-[2.3rem] font-semibold leading-none tracking-[-0.035em] text-[var(--mg-fg)]">
              fude
            </h1>
            {/* 筆で引いた墨の線。開いたときに左から伸びる。 */}
            <span className="mg-mark-stroke" aria-hidden />
            <p className="mt-1.5 text-[13.5px] text-[var(--mg-muted)]">
              ローカルの Markdown を、美しく読む
            </p>
          </div>
        </div>

        <div className="grid shrink-0 gap-3 sm:grid-cols-2">
          <StartCard
            icon="folder_open"
            title="フォルダを開く"
            lead="中の Markdown をぜんぶ読む"
            onClick={pickFolder}
          />
          <StartCard
            icon="description"
            title="ファイルを開く"
            lead="1 枚を、走査せずそのまま"
            onClick={pickFile}
          />
        </div>

        {recent.length > 0 && (
          <div className="mt-11 flex min-h-0 flex-col">
            <h2 className="mb-1 shrink-0 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--mg-muted)]">
              最近
            </h2>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {recent.map((r) => (
                <button
                  key={`${r.kind}:${r.id}`}
                  onClick={() =>
                    r.kind === "folder" ? void openFolder(r.path) : openDoc(r.path)
                  }
                  title={r.path}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-[var(--mg-hover)]"
                >
                  <Icon
                    name={r.kind === "folder" ? "folder" : "description"}
                    size={17}
                    className="shrink-0 text-[var(--mg-muted)]"
                  />
                  <span className="truncate text-[13.5px] font-medium text-[var(--mg-fg-dim)]">
                    {r.name}
                  </span>
                  {r.where && (
                    <span className="shrink-0 text-[11.5px] text-[var(--mg-muted)]">
                      · {r.where}
                    </span>
                  )}
                  {r.open > 0 && (
                    <span
                      className="mg-landing-count"
                      title={`未解決のコメント ${r.open} 件`}
                    >
                      <Icon name="chat_bubble" size={11} fill />
                      {r.open}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 tabular-nums text-[11px] text-[var(--mg-muted)]">
                    {timeAgo(r.lastOpened)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StartCard({
  icon,
  title,
  lead,
  onClick,
}: {
  icon: string;
  title: string;
  lead: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="mg-start-card">
      <span className="mg-start-tile">
        <Icon name={icon} size={20} />
      </span>
      <span className="mg-start-name">
        {title}
        <Icon name="arrow_forward" size={16} className="mg-start-go" />
      </span>
      <span className="mt-0.5 block text-[12px] text-[var(--mg-muted)]">{lead}</span>
    </button>
  );
}
