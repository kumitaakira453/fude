import { useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useStore } from "jotai";
import {
  activePaneIdAtom,
  activeFolderIdAtom,
  contentCacheAtom,
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
import { langOf } from "../lib/code";
import { imageUrl, peekImageUrl, readText } from "../lib/fsAccess";
import { parseFrontmatter } from "../lib/frontmatter";
import { kindOf } from "../lib/kind";
import { FileIcon } from "./FileIcon";
import { Icon } from "./Icon";
import { LoadingBody } from "./LoadingBody";
import { Markdown, stillTablesContext } from "./Markdown";
import { Marked } from "./Marked";
import { PathText, PickDetail, PickPanel } from "./PickPanel";
import { SourceView } from "./SourceView";
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

// 一覧の見出し。打つ前は最近使った操作を先に、打ったら操作とファイルに分ける。
type Section = "最近使った操作" | "操作" | "ファイル";

type Row =
  | { kind: "cmd"; cmd: Command; section: Section }
  | { kind: "file"; r: ReturnType<typeof quickOpen>[number]; section: Section };


// 右に出す本文の頭。Markdown は先頭の字数、それ以外は先頭の行数で切る。
const PEEK_CHARS = 8000;
const PEEK_LINES = 80;
// 中身を出せる種類。
const PEEKABLE = new Set(["markdown", "text", "image"]);
// ↑↓ で送っている間は読まない。選んだまま止まったら読む。
const PEEK_WAIT = 120;

// 選んでいるファイルの中身。字のファイルは本文の頭、画像は絵そのもの。
// PDF・HTML などは出さない。中は押せない。
function FilePeek(props: { path: string; abs: string; kept: Map<string, string | null> }) {
  const kind = kindOf(props.path);
  if (kind === "image") return <ImagePeek abs={props.abs} />;
  if (kind === "markdown" || kind === "text") return <TextPeek {...props} />;
  return null;
}

// 画像。開いたときと同じ読み方（控えがあればすぐ）で出し、欄に収める。
function ImagePeek({ abs }: { abs: string }) {
  const [url, setUrl] = useState<string | null>(() => peekImageUrl(abs));
  useEffect(() => {
    const ready = peekImageUrl(abs);
    setUrl(ready);
    if (ready) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void imageUrl(abs).then((u) => {
        if (live) setUrl(u);
      });
    }, PEEK_WAIT);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [abs]);
  if (!url) return null;
  return (
    <div className="mg-pal-peek is-img" aria-hidden>
      <img src={url} alt="" />
    </div>
  );
}

// 本文の頭。開いている本文があればそれを、無ければ読む。
// 読んだものは一覧を開いている間だけ控えておく（kept）。
function TextPeek({
  path,
  abs,
  kept,
}: {
  path: string;
  abs: string;
  kept: Map<string, string | null>;
}) {
  const cache = useAtomValue(contentCacheAtom);
  const kind = kindOf(path);
  const known = cache.get(path) ?? kept.get(path);
  const [text, setText] = useState<string | null | undefined>(known);
  useEffect(() => {
    if (known !== undefined) {
      setText(known);
      return;
    }
    setText(undefined);
    let live = true;
    const timer = window.setTimeout(() => {
      readText(abs)
        .then((t) => t, () => null)
        .then((t) => {
          kept.set(path, t);
          if (live) setText(t);
        });
    }, PEEK_WAIT);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [path, abs, known, kept]);

  if (text === null) return null;
  if (text === undefined) {
    return (
      <div className="mg-pal-peek">
        <LoadingBody />
      </div>
    );
  }
  if (kind === "markdown") {
    const { body } = parseFrontmatter(text);
    return (
      <div className="mg-pal-peek is-doc" aria-hidden>
        <div className="mg-prose prose mg-editorial">
          <stillTablesContext.Provider value={true}>
            <Markdown body={body.slice(0, PEEK_CHARS)} editorial />
          </stillTablesContext.Provider>
        </div>
      </div>
    );
  }
  // ファイルを開いたときと同じく、言語で色を付ける。
  return (
    <div className="mg-pal-peek is-src" aria-hidden>
      <SourceView code={text.split("\n").slice(0, PEEK_LINES).join("\n")} lang={langOf(path)} />
    </div>
  );
}

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
  // 右に出すために読んだ本文。開くたびに空にする。
  const peeked = useMemo(() => new Map<string, string | null>(), [open]);
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
    if (mode === "files") return results.map((r) => ({ kind: "file", r, section: "ファイル" }));
    const hits = commands.filter((c) => matchCommand(c, query));
    // 打つ前は、最近使った操作を先に出す。
    const recent = query.trim() ? [] : recentCommands();
    const rank = (c: Command) => {
      const at = recent.indexOf(c.id);
      return at < 0 ? 99 : at;
    };
    hits.sort((a, b) => rank(a) - rank(b));
    const cmds: Row[] = hits.map((cmd) => ({
      kind: "cmd",
      cmd,
      section: rank(cmd) < 99 ? "最近使った操作" : "操作",
    }));
    const fs: Row[] = query.trim()
      ? results.slice(0, FILES_IN_ALL).map((r) => ({ kind: "file", r, section: "ファイル" }))
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

  // 右の中身。選んでいる行のもの。
  const picked = rows[active];
  // ファイルは見出しを置かず、紙に中身だけを出す（名前・置き場・時刻は左の行にある）。
  // 中身を出せないもの（PDF・HTML など）は、紙の真ん中に絵だけを置く。
  // 紙の上には道筋を全部出す（左の行の置き場は残りの幅に入るぶんしか出ない）。
  const detail = !picked ? null : picked.kind === "file" ? (
    <>
      <div className="mg-pal-paper-path">
        <PathText path={label(picked.r.node.path)} />
      </div>
      <div className="mg-pal-paper">
        {PEEKABLE.has(kindOf(picked.r.node.path)) ? (
          <FilePeek path={picked.r.node.path} abs={picked.r.node.abs} kept={peeked} />
        ) : (
          <div className="mg-pal-paper-icon">
            <FileIcon name={picked.r.node.name} abs={picked.r.node.abs} size={40} />
          </div>
        )}
      </div>
    </>
  ) : (
    <PickDetail
      title={picked.cmd.label}
      facts={[
        picked.cmd.group,
        picked.cmd.keys ? <kbd className="mg-key">{picked.cmd.keys}</kbd> : null,
      ]}
    />
  );

  return (
    <PickPanel
      label={mode === "files" ? "ファイルを探す" : "操作とファイルを探す"}
      onClose={() => setOpen(false)}
      listRef={listRef}
      detail={detail}
      paper={picked?.kind === "file"}
      head={
        <div className="mg-pal-in">
          <Icon name="search" size={15} stroke={1.7} className="text-[var(--mg-muted)]" />
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
            placeholder={mode === "files" ? "ファイルを名前で探す" : "操作・ファイルを名前で探す"}
          />
          <kbd className="mg-key">esc</kbd>
        </div>
      }
      list={
        <>
          {rows.map((row, i) => {
            const head =
              mode === "all" && (i === 0 || rows[i - 1].section !== row.section) ? row.section : null;
            return (
              <div key={row.kind === "cmd" ? `c:${row.cmd.id}` : `f:${row.r.node.path}`}>
                {head && <div className="mg-pal-group">{head}</div>}
                <button
                  data-idx={i}
                  // 手が動いたときだけ選び直す。入った・出たで決めると、打つたびに
                  // 並びが変わったとき、動いていないマウスの下へ当たりが飛ぶ。
                  onMouseMove={(e) => movedIn(e) && hover(i)}
                  onClick={() => choose(i)}
                  data-on={i === active || undefined}
                  className="mg-pick-row mg-pal-row"
                >
                  {row.kind === "cmd" ? (
                    <>
                      <span className="mg-pal-name">
                        <Marked text={row.cmd.label} query={query} />
                      </span>
                      <span className="mg-pal-word">{row.cmd.group}</span>
                      <span className="mg-pal-keys">
                        {row.cmd.keys && <kbd className="mg-key">{row.cmd.keys}</kbd>}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="mg-pal-ficon" aria-hidden>
                        <FileIcon name={row.r.node.name} abs={row.r.node.abs} size={14} />
                      </span>
                      <span className="mg-pal-name" title={label(row.r.node.path)}>
                        <Marked text={row.r.node.name} query={query} />
                      </span>
                      {/* いつ触ったか。並び順の理由が読めるように添える。 */}
                      <span className="mg-pal-keys mg-pal-word">
                        {since(touched.get(row.r.node.path), now)}
                      </span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="px-3 py-6 text-center text-[13px] text-[var(--mg-muted)]">
              {mode === "files" ? "ファイルが見つかりません" : "当てはまるものがありません"}
            </div>
          )}
        </>
      }
      foot={
        <div className="mg-pal-foot">
          <span>
            <kbd className="mg-key">⏎</kbd> 開く・実行
          </span>
          <span>
            <kbd className="mg-key">↑</kbd>
            <kbd className="mg-key">↓</kbd> 選ぶ
          </span>
          {mode === "all" ? (
            <span>
              <kbd className="mg-key">⌘P</kbd> ファイルだけ
            </span>
          ) : (
            <span>
              <kbd className="mg-key">⌘⇧P</kbd> 操作も探す
            </span>
          )}
        </div>
      }
    />
  );
}
