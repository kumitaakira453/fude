import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { useWorkspace } from "../hooks/useWorkspace";
import { useWorkspaceOps } from "../hooks/useWorkspaceOps";
import { PHASE_LABEL } from "../lib/claude";
import { folderDisplayName, rootName } from "../lib/idb";
import { ago } from "../lib/when";
import { currentWindowLabel } from "../lib/windows";
import { colorVar, liveWorkspaces, type Workspace } from "../lib/workspaces";
import {
  foldersAtom,
  layoutAtom,
  workspaceAtom,
  workspaceMenuAtom,
  workspacesAtom,
  workspaceSwitcherOpenAtom,
} from "../state/atoms";
import { phaseForAtom } from "../state/claude";
import { refreshWorkspaces } from "../state/workspace";
import { barAtom, visitedAtom } from "../state/workspaceBar";
import { Icon } from "./Icon";
import { Marked } from "./Marked";
import { FileNames, PathList, PathText, PickDetail, PickPanel } from "./PickPanel";
import { keyedIn, movedIn } from "../lib/pointer";
import { WorkspaceChip } from "./WorkspaceChip";
import { absoluteLayout, tabsOf } from "../lib/ui";

// ワークスペースの一覧（⌘J・札の並びの ▾）。札の列に出していないものや、まだ
// ワークスペースになっていないフォルダもここから開ける。役目は探して開くこと
// だけ（作るのは札の並びの ＋、手入れは右押しのメニュー）。
// Enter で今のウィンドウを切り替え、⌘Enter で新しいウィンドウに開く。

const matches = (ws: Workspace, names: string[], q: string): boolean => {
  if (!q) return true;
  const hay = [ws.name, ...names].join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
};

export function WorkspaceSwitcher() {
  const [open, setOpen] = useAtom(workspaceSwitcherOpenAtom);
  const list = useAtomValue(workspacesAtom);
  const visited = useAtomValue(visitedAtom);
  const bar = useAtomValue(barAtom);
  const current = useAtomValue(workspaceAtom);
  const folders = useAtomValue(foldersAtom);
  const phaseFor = useAtomValue(phaseForAtom);
  const layout = useAtomValue(layoutAtom);
  const openMenu = useSetAtom(workspaceMenuAtom);
  const store = useStore();
  const { openWorkspace, openFolder, openFolderInNewWindow } = useWorkspace();
  const ops = useWorkspaceOps();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // 別のウィンドウで開いているもの（ID → ウィンドウの名前）。
  const [elsewhere, setElsewhere] = useState<Map<string, string>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  // 打ったかどうか。開いた直後の当たり（直前のもの）を、打つまでは動かさない。
  const typed = useRef(false);
  // 塗りは CSS の :hover で即座に出す。状態はキー操作を続ける起点だけに使う。
  const byMouse = useRef(false);
  const hover = (i: number) =>
    setActive((a) => {
      if (a === i) return a;
      byMouse.current = true;
      return i;
    });
  const ime = useImeSafeEnter();
  // 並べる時刻は開いたときに 1 度だけ決める。
  const now = useMemo(() => Date.now(), [open]);

  useEffect(() => {
    if (!open) return;
    typed.current = false;
    setQuery("");
    setActive(current && list.length > 0 ? 1 : 0);
    void refreshWorkspaces(store);
    const me = currentWindowLabel();
    void liveWorkspaces()
      .then((live) => setElsewhere(new Map(live.filter(([l]) => l !== me).map(([l, id]) => [id, l]))))
      .catch(() => setElsewhere(new Map()));
  }, [open, store]);

  const rows = useMemo(() => {
    // 控えをまだ書き終えていなくても、今開いているものは必ず並べる。
    const merged = current
      ? list.some((w) => w.id === current.id)
        ? list.map((w) => (w.id === current.id ? current : w))
        : [current, ...list]
      : list;
    // 今いるものを先頭に、続けてこのウィンドウで開いた順、札の並び、残りは
    // 開いた時刻の新しい順。開いたときの当たりは 2 番目（直前のもの）。
    const rank = (ws: Workspace) => {
      if (ws.id === current?.id) return -1;
      const v = visited.indexOf(ws.id);
      if (v >= 0) return v;
      const b = bar.indexOf(ws.id);
      return b >= 0 ? 1000 + b : 2000;
    };
    return [...merged]
      .sort((a, b) => rank(a) - rank(b) || b.lastOpened - a.lastOpened)
      .map((ws) => ({ ws, names: ws.roots.map((r) => rootName(folders, r)) }))
      .filter(({ ws, names }) => matches(ws, names, query.trim()));
  }, [list, current, folders, query, visited, bar]);

  // 開いたことはあるが、まだワークスペースになっていないフォルダ。選ぶとその
  // フォルダのワークスペースができる。
  const loose = useMemo(() => {
    const owned = new Set(
      [...list, ...(current ? [current] : [])].flatMap((w) => (w.folder ? [w.folder] : [])),
    );
    const q = query.trim().toLowerCase();
    return [...folders]
      .filter((f) => !owned.has(f.path))
      .filter((f) => {
        if (!q) return true;
        const hay = `${folderDisplayName(f)} ${f.path}`.toLowerCase();
        return q.split(/\s+/).every((word) => hay.includes(word));
      })
      .sort((a, b) => b.lastOpened - a.lastOpened);
  }, [folders, list, current, query]);
  const total = rows.length + loose.length;

  useEffect(() => {
    // 打ち始めたら、絞り込んだ先頭に当てる（開いた直後の「直前のもの」から移る）。
    if (!typed.current) return;
    setActive(0);
  }, [query]);
  useEffect(() => {
    // マウスで当てた行はもう見えている。スクロールさせない。
    if (byMouse.current) {
      byMouse.current = false;
      return;
    }
    keyedIn(listRef.current);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const close = () => setOpen(false);

  const choose = (i: number, newWindow: boolean) => {
    const row = rows[i];
    if (row) {
      close();
      // 今いるものは 1 つのウィンドウでしか開かない（新しいウィンドウには出さない）。
      if (newWindow && row.ws.id === current?.id) return;
      if (newWindow) void ops.openInNewWindow(row.ws);
      else void openWorkspace(row.ws);
      return;
    }
    const folder = loose[i - rows.length];
    if (!folder) return;
    close();
    if (newWindow) void openFolderInNewWindow(folder.path, folderDisplayName(folder));
    else void openFolder(folder.path);
  };

  // 右の中身。今選んでいる行のもの。
  const detail = (() => {
    const row = rows[active];
    if (row) {
      const { ws } = row;
      const here = current?.id === ws.id;
      const phase = phaseFor(ws);
      // 今いるものは今のタブ、ほかは控えのタブ（相対で控えた頃のものは根から読む）。
      const tabs = here
        ? tabsOf(layout)
        : ws.layout
          ? tabsOf(ws.roots[0] ? absoluteLayout(ws.layout, ws.roots[0]) : ws.layout)
          : [];
      return (
        <PickDetail
          color={colorVar(ws.color)}
          title={ws.name}
          facts={[
            here ? <b>今</b> : ws.lastOpened > 0 ? <b>{ago(ws.lastOpened, now)}</b> : null,
            tabs.length > 0 ? (
              <>
                <b>{tabs.length}</b> ファイル
              </>
            ) : null,
            phase && PHASE_LABEL[phase] ? (
              <span className={`mg-ws-pill-badge is-${phase}`}>{PHASE_LABEL[phase]}</span>
            ) : null,
            here ? "このウィンドウ" : elsewhere.has(ws.id) ? "別のウィンドウ" : null,
          ]}
          sections={[
            ["フォルダ", ws.roots.length > 0 ? <PathList paths={ws.roots} /> : null],
            ["開いているファイル", tabs.length > 0 ? <FileNames names={tabs.map(baseName)} /> : null],
          ]}
        />
      );
    }
    const folder = loose[active - rows.length];
    if (folder) {
      return (
        <PickDetail
          icon={<Icon name="folder" size={16} className="text-[var(--mg-muted)]" />}
          title={folderDisplayName(folder)}
          facts={[<b>{ago(folder.lastOpened, now)}</b>]}
          sections={[["フォルダ", <PathText path={folder.path} />]]}
        />
      );
    }
    return <span />;
  })();

  return (
    <PickPanel
      onClose={close}
      listRef={listRef}
      detail={detail}
      head={
        <div className="mg-pal-in">
          <Icon name="search" size={15} stroke={1.7} className="text-[var(--mg-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              typed.current = true;
              setQuery(e.target.value);
            }}
            onKeyUp={ime.onKeyUp}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(e) => {
              if (ime.isComposing(e)) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, total - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(active, e.metaKey);
              } else if (e.key === "Escape") {
                close();
              }
            }}
            placeholder="ワークスペースを名前・フォルダで探す"
          />
          <kbd className="mg-key">esc</kbd>
        </div>
      }
      list={
        <>
          {total === 0 && (
            <div className="px-3 py-6 text-center text-[13px] text-[var(--mg-muted)]">
              {list.length === 0 && folders.length === 0
                ? "まだ何もありません。フォルダを開くと、そのフォルダのワークスペースができます"
                : "一致するものがありません"}
            </div>
          )}
          {rows.length > 0 && <div className="mg-pal-group">ワークスペース</div>}
          {rows.map(({ ws }, i) => {
            const here = current?.id === ws.id;
            const other = elsewhere.get(ws.id);
            const phase = phaseFor(ws);
            return (
              <div
                key={ws.id}
                data-idx={i}
                onMouseMove={(e) => movedIn(e) && hover(i)}
                onClick={(e) => choose(i, e.metaKey)}
                onMouseDown={(e) => {
                  // 右ボタンで押した瞬間に、下の語が選ばれるのを止める。
                  if (e.button === 2) e.preventDefault();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu({ id: ws.id, x: e.clientX, y: e.clientY });
                }}
                data-on={i === active || undefined}
                className="mg-pick-row mg-pal-row cursor-pointer"
              >
                <WorkspaceChip ws={ws} size={18} />
                <span className="mg-pal-name">
                  <Marked text={ws.name} query={query} />
                </span>
                {phase && PHASE_LABEL[phase] && (
                  <span className={`mg-ws-pill-badge is-${phase}`}>{PHASE_LABEL[phase]}</span>
                )}
                {here && <span className="mg-pal-word">このウィンドウ</span>}
                {!here && other && <span className="mg-pal-word">別のウィンドウ</span>}
                <span className="mg-pal-keys mg-pal-word">
                  {!here && ws.lastOpened > 0 ? ago(ws.lastOpened, now) : ""}
                </span>
              </div>
            );
          })}

          {loose.length > 0 && <div className="mg-pal-group">開いたことのあるフォルダ</div>}
          {loose.map((f, j) => {
            const i = rows.length + j;
            return (
              <div
                key={f.path}
                data-idx={i}
                onMouseMove={(e) => movedIn(e) && hover(i)}
                onClick={(e) => choose(i, e.metaKey)}
                data-tip="開くと、このフォルダのワークスペースができます"
                data-on={i === active || undefined}
                className="mg-pick-row mg-pal-row cursor-pointer"
              >
                <Icon name="folder" size={14} className="text-[var(--mg-muted)]" />
                <span className="mg-pal-name">
                  <Marked text={folderDisplayName(f)} query={query} />
                </span>
                <span className="mg-pal-word mg-pal-place" title={f.path}>
                  <bdi>{f.path}</bdi>
                </span>
                <span className="mg-pal-keys mg-pal-word">{ago(f.lastOpened, now)}</span>
              </div>
            );
          })}
        </>
      }
      foot={
        <div className="mg-pal-foot">
          <span className="mg-pal-foot-note" title="右クリックで名前・色・フォルダの変更、削除">
            右クリックで名前・色・フォルダの変更、削除
          </span>
          <span>
            <kbd className="mg-key">⏎</kbd> 開く
          </span>
          <span>
            <kbd className="mg-key">⌘⏎</kbd> 新しいウィンドウ
          </span>
        </div>
      }
    />
  );
}

const baseName = (path: string): string => path.split("/").pop() ?? path;
