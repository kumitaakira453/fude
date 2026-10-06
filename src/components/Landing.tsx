import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useWorkspace } from "../hooks/useWorkspace";
import { displayName, pickDirectory } from "../lib/fsAccess";
import { pickDocFile } from "../lib/kind";
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
  const { openFolder, openDoc, newDraft } = useWorkspace();

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
    const path = await pickDocFile();
    if (path) openDoc(path);
  };

  return (
    <div className="mg-landing flex h-full flex-col">
      {/* 窓のタイトルバーの代わり。掴むと窓を動かせる（ほかの全面の画面と同じ帯）。 */}
      <header className="mg-screenbar" data-tauri-drag-region />

      <div className="mg-landing-body">
        <div className="mg-landing-mark">
          <AppIcon size={30} className="shrink-0 text-[var(--mg-accent)]" />
          <h1 className="mg-wordmark">fude</h1>
          <p className="mg-landing-lead">ローカルの Markdown を読む・書く・指摘する</p>
        </div>

        <div className="mg-start">
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
          <StartCard
            icon="note_add"
            title="新しいメモ"
            lead="保存先は書いたあとで"
            onClick={() => void newDraft()}
          />
        </div>

        {recent.length > 0 && (
          <section className="mg-landing-recent">
            {/* 見出しは左の欄の根の見出しと同じ形 */}
            <h2 className="mg-landing-head">
              最近
              <span className="mg-landing-head-n">{recent.length}</span>
            </h2>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {recent.map((r) => (
                <button
                  key={`${r.kind}:${r.id}`}
                  onClick={() =>
                    r.kind === "folder" ? void openFolder(r.path) : openDoc(r.path)
                  }
                  title={r.path}
                  className="mg-landing-row"
                >
                  <Icon name={r.kind === "folder" ? "folder" : "description"} size={14} />
                  <span className="mg-landing-name">{r.name}</span>
                  {r.where && <span className="mg-landing-where">{r.where}</span>}
                  {r.open > 0 && (
                    <span
                      className="mg-ws-pill-badge is-waiting"
                      title={`未解決のコメント ${r.open} 件`}
                    >
                      コメント {r.open}
                    </span>
                  )}
                  <span className="mg-landing-when">{timeAgo(r.lastOpened)}</span>
                </button>
              ))}
            </div>
          </section>
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
      <Icon name={icon} size={16} className="mg-start-ico" />
      <span className="mg-start-name">{title}</span>
      <span className="mg-start-lead">{lead}</span>
    </button>
  );
}
