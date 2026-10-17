import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceOps } from "../hooks/useWorkspaceOps";
import { PHASE_LABEL, phaseOf, type ClaudeSession } from "../lib/claude";
import { rootName } from "../lib/idb";
import { ago } from "../lib/when";
import { rootsSummary, type Workspace } from "../lib/workspaces";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  claudeLinkAtom,
  claudeSessionsAtom,
  foldersAtom,
  layoutAtom,
  newWorkspaceAtom,
  workspaceAtom,
  workspacesAtom,
} from "../state/atoms";
import { FolderChooser } from "./FolderChooser";
import { Icon } from "./Icon";
import { Marked } from "./Marked";
import { FileNames, PathList, PathText, PickDetail, PickPanel } from "./PickPanel";
import { tabsOf } from "../lib/ui";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { keyedIn, movedIn } from "../lib/pointer";

// ワークスペースを作る一覧（札の並びの末尾の ＋・⌘T）。作る入口はここだけ。
// ⌘⇧P と同じ枠で真ん中に出す。打った字でセッションを絞り込み、上下と Enter で選ぶ。

// 並べるセッションの数（打つ前）。打てば全部から探す。
const SESSIONS_SHOWN = 12;

type Row =
  | { kind: "make"; id: string; icon: string; label: string; note: string; run: () => void }
  | { kind: "session"; id: string; s: ClaudeSession; ws: Workspace | undefined };

export function NewWorkspace() {
  const [open, setOpen] = useAtom(newWorkspaceAtom);
  const current = useAtomValue(workspaceAtom);
  const list = useAtomValue(workspacesAtom);
  const folders = useAtomValue(foldersAtom);
  const claudeOn = useAtomValue(claudeLinkAtom);
  const claude = useAtomValue(claudeSessionsAtom);
  const layout = useAtomValue(layoutAtom);
  const ops = useWorkspaceOps();
  const { openWorkspace } = useWorkspace();
  const ime = useImeSafeEnter();
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const now = useMemo(() => Date.now(), [open]);

  useEffect(() => {
    setChoosing(false);
    setQuery("");
    setActive(0);
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    keyedIn(listRef.current);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => setOpen(false);

  // セッションを新しく始めた順に。すでにワークスペースがあるものは、そのワーク
  // スペースを添える（押すと作らずにそれを開く）。
  const sessions = useMemo(() => {
    if (!claudeOn || !claude) return [];
    const byId = new Map<string, Workspace>();
    for (const w of [...list, ...(current ? [current] : [])]) {
      if (w.claude) byId.set(w.claude.sessionId, w);
    }
    return claude.sessions
      .map((s) => ({ s, ws: byId.get(s.sessionId) }))
      .sort((a, b) => (b.s.startedAt ?? 0) - (a.s.startedAt ?? 0));
  }, [claudeOn, claude, list, current]);

  // 数行と、多くても数十件のセッション。描くたびに組み直して足りる。
  const rows = ((): Row[] => {
    const here = current ? rootsSummary(current.roots.map((r) => rootName(folders, r))) : "";
    const makes: Row[] = [
      ...(current
        ? [
            {
              kind: "make" as const,
              id: "here",
              icon: "add",
              label: "今のフォルダで新規作成",
              note: here,
              run: () => {
                close();
                void ops.createWorkspace({ roots: current.roots });
              },
            },
          ]
        : []),
      {
        kind: "make",
        id: "pick",
        icon: "folder_open",
        label: "フォルダを選んで新規作成…",
        note: "以前開いたフォルダから選べます",
        run: () => setChoosing(true),
      },
      ...(current
        ? [
            {
              kind: "make" as const,
              id: "copy",
              icon: "content_copy",
              label: "今のタブを複製して新規作成",
              note: "フォルダと開いているタブをそのまま引き継ぎます",
              run: () => {
                close();
                void ops.createWorkspace({ copy: true });
              },
            },
          ]
        : []),
    ];
    const q = query.trim().toLowerCase();
    const hit = (t: string) => q === "" || t.toLowerCase().includes(q);
    const found = sessions
      .filter(({ s }) => hit(s.name || s.sessionId))
      .slice(0, q ? undefined : SESSIONS_SHOWN)
      .map(({ s, ws }): Row => ({ kind: "session", id: s.sessionId, s, ws }));
    return [...makes.filter((m) => m.kind === "make" && hit(m.label)), ...found];
  })();

  if (!open) return null;

  const choose = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === "make") {
      row.run();
      return;
    }
    close();
    if (row.ws) void openWorkspace(row.ws);
    else void ops.createFromSession(row.s);
  };

  // フォルダを選ぶ段は、その段だけの枠で出す（右の中身は持たない）。
  if (choosing) {
    return (
      <div className="mg-scrim fixed inset-0 z-50 flex items-start justify-center pt-[52px]" onClick={close}>
        <div
          role="dialog"
          aria-label="新しいワークスペース"
          className="mg-pop mg-pal"
          onClick={(e) => e.stopPropagation()}
        >
          <FolderChooser
            mode="create"
            // 今のフォルダを最初から選んでおかない。新しく作るときは、たいてい別の組み合わせにする。
            initial={[]}
            hidden={[]}
            pickOther={ops.pickOtherFolder}
            onBack={() => setChoosing(false)}
            onDone={(roots, name, newWindow) => {
              close();
              void ops.createWorkspace({ roots, name, newWindow });
            }}
          />
        </div>
      </div>
    );
  }

  // 右の中身。今選んでいる行のもの。
  const picked = rows[active];
  const detail = !picked ? (
    <span />
  ) : picked.kind === "session" ? (
    <SessionDetail s={picked.s} ws={picked.ws} now={now} />
  ) : (
    <PickDetail
      icon={<Icon name={picked.icon} size={16} className="text-[var(--mg-muted)]" />}
      title={picked.label}
      sections={[
        [
          "フォルダ",
          picked.id !== "pick" && current && current.roots.length > 0 ? (
            <PathList paths={current.roots} />
          ) : null,
        ],
        [
          "引き継ぐタブ",
          picked.id === "copy" && tabsOf(layout).length > 0 ? (
            <FileNames names={tabsOf(layout).map((p) => p.split("/").pop() ?? p)} />
          ) : null,
        ],
      ]}
    />
  );

  return (
    <PickPanel
      label="新しいワークスペース"
      onClose={close}
      listRef={listRef}
      detail={detail}
      head={
        <div className="mg-pal-in">
          <Icon name="add" size={15} stroke={1.7} className="text-[var(--mg-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyUp={ime.onKeyUp}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(e) => {
              if (ime.isComposing(e)) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(active);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
            placeholder={claudeOn ? "新しいワークスペース（セッション名で絞り込み）" : "新しいワークスペース"}
          />
          <kbd className="mg-key">esc</kbd>
        </div>
      }
      list={
        <>
          {rows.map((row, i) => {
            const head =
              i === 0 && row.kind === "make"
                ? "作り方"
                : row.kind === "session" && (i === 0 || rows[i - 1].kind !== "session")
                  ? "Claude のセッションから作成"
                  : null;
            return (
              <div key={row.id}>
                {head && (
                  <div className="mg-pal-group">
                    {head}
                    {row.kind === "session" && <span className="mg-set-beta ml-1.5">Beta</span>}
                  </div>
                )}
                <button
                  type="button"
                  data-idx={i}
                  data-on={i === active || undefined}
                  onMouseMove={(e) => movedIn(e) && setActive(i)}
                  onClick={() => choose(i)}
                  data-tip={
                    row.kind === "session"
                      ? row.ws
                        ? `ワークスペース「${row.ws.name}」を開く`
                        : "このセッションからワークスペースを作成"
                      : undefined
                  }
                  className="mg-pick-row mg-pal-row"
                >
                  {row.kind === "make" ? (
                    <>
                      <Icon name={row.icon} size={14} className="text-[var(--mg-muted)]" />
                      <span className="mg-pal-name">{row.label}</span>
                      <span className="mg-pal-word">{row.note}</span>
                    </>
                  ) : (
                    <SessionRow s={row.s} ws={row.ws} now={now} query={query} />
                  )}
                </button>
              </div>
            );
          })}
          {claudeOn && !claude && <p className="mg-pal-note">セッションを読み込んでいます…</p>}
          {claudeOn && claude?.error && (
            <p className="mg-pal-note" data-tip={claude.error}>
              Claude のセッションを読み込めません（設定の「Claude」で原因を確認できます）
            </p>
          )}
          {rows.length === 0 && <p className="mg-pal-note">当てはまるものがありません</p>}
        </>
      }
      foot={
        <div className="mg-pal-foot">
          <span>
            <kbd className="mg-key">⏎</kbd> 作る・開く
          </span>
          <span>
            <kbd className="mg-key">↑</kbd>
            <kbd className="mg-key">↓</kbd> 選ぶ
          </span>
        </div>
      }
    />
  );
}

// セッションの中身。書いたファイルの数は、ワークスペースと結び付いているときだけ
// 手元にある（結び付いていないものは記録を読み直さないと分からない）。
function SessionDetail({
  s,
  ws,
  now,
}: {
  s: ClaudeSession;
  ws: Workspace | undefined;
  now: number;
}) {
  const phase = phaseOf(s, { readable: true, transcriptGone: false });
  return (
    <PickDetail
      icon={<Icon name="claude" size={14} stroke={1.8} className="text-[var(--mg-muted)]" />}
      title={s.name || s.sessionId.slice(0, 8)}
      facts={[
        PHASE_LABEL[phase] ? (
          <span className={`mg-ws-pill-badge is-${phase}`}>{PHASE_LABEL[phase]}</span>
        ) : null,
        s.startedAt ? <b>{ago(s.startedAt, now)}</b> : null,
        ws?.claude?.wrote ? (
          <>
            書いたファイル <b>{ws.claude.wrote.length}</b> 件
          </>
        ) : null,
      ]}
      sections={[
        ["場所", s.cwd ? <PathText path={s.cwd} /> : null],
        ["ワークスペース", ws ? ws.name : "まだ無い"],
      ]}
    />
  );
}

function SessionRow({
  s,
  ws,
  now,
  query,
}: {
  s: ClaudeSession;
  ws: Workspace | undefined;
  now: number;
  query: string;
}) {
  const phase = phaseOf(s, { readable: true, transcriptGone: false });
  return (
    <>
      <Icon name="claude" size={12} stroke={1.8} className="text-[var(--mg-muted)]" />
      <span className="mg-pal-name">
        <Marked text={s.name || s.sessionId.slice(0, 8)} query={query} />
      </span>
      {PHASE_LABEL[phase] && <span className={`mg-ws-pill-badge is-${phase}`}>{PHASE_LABEL[phase]}</span>}
      {ws && <span className="mg-pal-word">作成済み</span>}
      <span className="mg-pal-keys mg-pal-word">{s.startedAt ? ago(s.startedAt, now) : ""}</span>
    </>
  );
}
