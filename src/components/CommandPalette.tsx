import { useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useStore } from "jotai";
import {
  activePaneIdAtom,
  activeFolderIdAtom,
  filesAtom,
  paletteModeAtom,
  paletteOpenAtom,
  panesAtom,
  pathLabelAtom,
  readingWidthAtom,
  soleAtom,
  touchedAtom,
  workspaceAtom,
  workspacesAtom,
} from "../state/atoms";
import {
  keyedCommands,
  matchCommand,
  recentCommands,
  rememberCommand,
  type Command,
} from "../lib/commands";
import { closePane, splitInto } from "../lib/ui";
import { quickOpen } from "../lib/search";
import { markInTree } from "../lib/ui";
import { useWorkspace } from "../hooks/useWorkspace";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";
import { Icon } from "./Icon";
import { keyedIn, movedIn } from "../lib/pointer";

// 触ってからの経過。細かい数字は要らないので、桁が分かる粒度で出す。
function since(at: number | undefined, now: number): string {
  if (!at) return "";
  const min = (now - at) / 60000;
  if (min < 1) return "たった今";
  if (min < 60) return `${Math.floor(min)} 分前`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} 時間前`;
  const day = Math.floor(min / 60 / 24);
  return day < 30 ? `${day} 日前` : `${Math.floor(day / 30)} か月前`;
}

// ファイルと操作を名前で探す一覧。⌘P はファイルだけ、⌘⇧P は操作とファイル。
// ファイルの並びは「名前の一致」と「最後に触った新しさ」で決める。操作は台帳
// （lib/commands）の名前で当て、最近使ったものを先に出す。

type Row =
  | { kind: "cmd"; cmd: Command }
  | { kind: "file"; r: ReturnType<typeof quickOpen>[number] };

// 操作の一覧に混ぜて出すファイルの数。
const FILES_IN_ALL = 8;
const WIDTHS = ["cozy", "wide", "full"] as const;
export function CommandPalette() {
  const [open, setOpen] = useAtom(paletteOpenAtom);
  const files = useAtomValue(filesAtom);
  const touched = useAtomValue(touchedAtom);
  const label = useAtomValue(pathLabelAtom);
  const { openFile, openWorkspace, holdDraft } = useWorkspace();
  const mode = useAtomValue(paletteModeAtom);
  const workspaces = useAtomValue(workspacesAtom);
  const here = useAtomValue(workspaceAtom);
  const panes = useAtomValue(panesAtom);
  const store = useStore();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // 塗りは CSS の :hover で即座に出す。状態はキー操作を続ける起点だけに使う。
  const byMouse = useRef(false);
  const hover = (i: number) =>
    setActive((a) => {
      if (a === i) return a;
      byMouse.current = true;
      return i;
    });
  const ime = useImeSafeEnter();

  // 開いた時刻は開くたびに 1 度だけ決める。1 文字打つたびに now が動くと、
  // 同じ並びのはずのものが入れ替わって落ち着かない。
  const now = useMemo(() => Date.now(), [open]);
  const results = useMemo(
    () => quickOpen(files, query, { touched, now }),
    [files, query, touched, now],
  );

  // 台帳の操作に、その場の状態で決まるもの（行き先のワークスペースなど）を足す。
  const commands = useMemo((): Command[] => {
    const home = () => {
      store.set(soleAtom, null);
      store.set(activeFolderIdAtom, null);
    };
    const extra: Command[] = [
      { id: "home", label: "スタート画面へ", group: "全体", run: () => void (holdDraft(home) || home()) },
      { id: "split.down", label: "下に分割", group: "タブと分割", also: "分割", run: () => splitInto(store, "col") },
      ...(panes.length > 1
        ? [{ id: "split.close", label: "分割を解除", group: "タブと分割" as const, run: () => closePane(store, store.get(activePaneIdAtom)) }]
        : []),
      {
        id: "width",
        label: "本文の幅を切り替える",
        group: "右の欄",
        run: () => {
          const w = store.get(readingWidthAtom);
          store.set(readingWidthAtom, WIDTHS[(WIDTHS.indexOf(w) + 1) % WIDTHS.length]);
        },
      },
      ...workspaces
        .filter((w) => w.id !== here?.id)
        .map(
          (w): Command => ({
            id: `ws:${w.id}`,
            label: `ワークスペースへ移る：${w.name}`,
            group: "ワークスペース",
            run: () => void openWorkspace(w),
          }),
        ),
    ];
    return [...keyedCommands(), ...extra];
  }, [store, holdDraft, panes.length, workspaces, here?.id, openWorkspace]);

  const rows = useMemo((): Row[] => {
    if (mode === "files") return results.map((r) => ({ kind: "file", r }));
    const hits = commands.filter((c) => matchCommand(c, query));
    // 打つ前は、最近使った操作を先に出す。
    const recent = query.trim() ? [] : recentCommands();
    hits.sort((a, b) => {
      const ra = recent.indexOf(a.id);
      const rb = recent.indexOf(b.id);
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    });
    const cmds: Row[] = hits.map((cmd) => ({ kind: "cmd", cmd }));
    const fs: Row[] = query.trim()
      ? results.slice(0, FILES_IN_ALL).map((r) => ({ kind: "file", r }))
      : [];
    return [...cmds, ...fs];
  }, [mode, results, commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    // マウスで当てた行はもう見えている。スクロールさせない。
    if (byMouse.current) {
      byMouse.current = false;
      return;
    }
    keyedIn(listRef.current);
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const choose = (i: number) => {
    const row = rows[i];
    if (!row) return;
    setOpen(false);
    if (row.kind === "cmd") {
      rememberCommand(row.cmd.id);
      // 一覧を閉じてから実行する（一覧が受けるキーと取り合わない）。
      window.setTimeout(row.cmd.run, 0);
      return;
    }
    openFile(row.r.node.path);
    // 探して開いたファイルは、ツリーでも居場所が分かるようにする。
    markInTree(store, row.r.node.path);
  };

  return (
    <div
      className="mg-scrim fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="mg-pop w-full max-w-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--mg-border)] px-4">
          <Icon name="search" size={18} className="shrink-0 text-[var(--mg-muted)]" />
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
              setActive((a) => Math.min(a + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(active);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
            placeholder={
              mode === "files"
                ? "ファイルを開く…（ファイル名で絞り込み）"
                : "操作・ファイルを名前で探す…"
            }
            className="w-full bg-transparent py-3 text-[15px] outline-none placeholder:text-[var(--mg-muted)]"
          />
        </div>
        <div ref={listRef} className="mg-pick-list max-h-[50vh] overflow-y-auto py-1">
          {rows.map((row, i) => {
            const head =
              row.kind === "cmd"
                ? i === 0 || rows[i - 1].kind !== "cmd" || (rows[i - 1] as { cmd: Command }).cmd.group !== row.cmd.group
                  ? row.cmd.group
                  : null
                : i === 0 || rows[i - 1].kind !== "file"
                  ? mode === "all"
                    ? "ファイル"
                    : null
                  : null;
            return (
              <div key={row.kind === "cmd" ? `c:${row.cmd.id}` : `f:${row.r.node.path}`}>
                {head && <div className="mg-pal-group">{head}</div>}
                {row.kind === "cmd" ? (
                  <button
                    data-idx={i}
                    onMouseMove={(e) => movedIn(e) && hover(i)}
                    onClick={() => choose(i)}
                    data-on={i === active || undefined}
                    className="mg-pick-row mg-pal-row"
                  >
                    <span className="min-w-0 flex-1 truncate">{row.cmd.label}</span>
                    {row.cmd.keys && <kbd className="mg-key">{row.cmd.keys}</kbd>}
                  </button>
                ) : (
                  <button
                    data-idx={i}
                    // 手が動いたときだけ選び直す。入った・出たで決めると、打つたびに
                    // 並びが変わったとき、動いていないマウスの下へ当たりが飛ぶ。
                    onMouseMove={(e) => movedIn(e) && hover(i)}
                    onClick={() => choose(i)}
                    data-on={i === active || undefined}
                    className="mg-pick-row flex w-full flex-col items-start px-4 py-1.5 text-left"
                  >
                    <span className="flex w-full items-baseline gap-2 text-[13.5px] text-[var(--mg-fg)]">
                      <span className="min-w-0 flex-1 truncate">
                        {row.r.node.name.replace(/\.(md|markdown|mdx|mdown|mkd)$/i, "")}
                      </span>
                      {/* いつ触ったか。並び順の理由が読めるように添える。 */}
                      <span className="shrink-0 text-[10.5px] text-[var(--mg-muted)]">
                        {since(touched.get(row.r.node.path), now)}
                      </span>
                    </span>
                    <span className="w-full truncate text-[11px] text-[var(--mg-muted)]">
                      {label(row.r.node.path)}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-[var(--mg-muted)]">
              {mode === "files" ? "ファイルが見つかりません" : "当てはまるものがありません"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
