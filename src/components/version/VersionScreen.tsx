import { confirm } from "@tauri-apps/plugin-dialog";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAfterPaint } from "../../hooks/useAfterPaint";
import { useWorkspace } from "../../hooks/useWorkspace";
import { splitBlocks } from "../../lib/blocks";
import { fontStack } from "../../lib/fonts";
import { parseFrontmatter } from "../../lib/frontmatter";
import { readVersion, restoreVersion, type ReviewVersion } from "../../lib/review";
import { lineDiff } from "../../lib/lineDiff";
import { WIDTH_CLASS } from "../../lib/ui";
import {
  ACTOR_ICON,
  actorOf,
  fullyOf,
  labelOf,
  noteOf,
  versionsOf,
  whenOf,
} from "../../lib/versions";
import {
  contentCacheAtom,
  editorialAtom,
  fontAtom,
  readingWidthAtom,
} from "../../state/atoms";
import { ledgerAtom, syncLedger, versionScreenAtom } from "../../state/review";
import { notify } from "../../state/toast";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";
import { markdownContext } from "../MarkdownContext";
import { SourceDiff } from "./SourceDiff";
import { VersionDiff, type Layout } from "./VersionDiff";

// バージョンの履歴。左にバージョンを新しい順に並べ、右に選んだものを出す。
//
// 本文に重ねず別画面で出す。差分は変更前と変更後を並べて見せるものなので、
// 読む画面の幅には収まらない。
//
// 一覧に並ぶのはバージョンだけ。まだ打っていない今の本文（「いま」）は
// バージョンではないので並べず、差分の比較対象としてだけ選べるようにする。

type Mode = "body" | "diff";

// 「いま」を表す選択。バージョン ID を持たないので null で表す。
type Pick = string | null;

const MODES: { id: Mode; label: string }[] = [
  { id: "body", label: "本文" },
  { id: "diff", label: "比べる" },
];

const LAYOUTS: { id: Layout; label: string }[] = [
  { id: "unified", label: "統合" },
  { id: "split", label: "分割" },
];

export function VersionScreen({ path }: { path: string }) {
  const store = useStore();
  const ledger = useAtomValue(ledgerAtom);
  const cache = useAtomValue(contentCacheAtom);
  const editorial = useAtomValue(editorialAtom);
  const font = useAtomValue(fontAtom);
  const width = useAtomValue(readingWidthAtom);
  const close = useSetAtom(versionScreenAtom);
  const { absOf, reloadFile, resolveAsset, peekAsset } = useWorkspace();

  const abs = absOf(path);
  const current = cache.get(path);
  const list = useMemo(() => (abs ? versionsOf(ledger, abs) : []), [ledger, abs]);

  // 選んでいるバージョン。null になるのは 1 つも無いときだけ。
  const [picked, setPicked] = useState<Pick>(null);
  // 既定は本文。選んだバージョンが実際どう見えるかを先に出し、差分は
  // 求められたら出す。
  const [mode, setMode] = useState<Mode>("body");
  const [layout, setLayout] = useState<Layout>("unified");
  // ソースのまま比べるか。組版を通した比較では記法の違いが読み取れない。
  const [source, setSource] = useState(false);
  // 差分の比較対象。undefined は「まだ選んでいない」で、既定に従う。
  const [against, setAgainst] = useState<Pick | undefined>(undefined);
  const [restoring, setRestoring] = useState<string | null>(null);
  // state は再描画されるまで更新されないので、素早い 2 回目のクリックが
  // 同じ値を読んで通り抜けてしまう。同期的に読める参照で締め出す。
  const running = useRef(false);

  // 本文キャッシュに無いときは読む。履歴は本文の画面から開くので普通は
  // 入っているが、ウィンドウを開いた直後は走査が終わっていない。
  useEffect(() => {
    if (current === undefined) void reloadFile(path);
  }, [current, path, reloadFile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
      close(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // 開いた直後と、選んでいたバージョンが消えたとき（別のウィンドウで台帳が
  // 変わった等）は、いちばん新しいバージョンへ寄せる。
  useEffect(() => {
    if (picked === null || !list.some((v) => v.id === picked)) {
      setPicked(list[0]?.id ?? null);
    }
  }, [list, picked]);

  // バージョンを選ぶ。比較対象と同じものを選ぶと差分が空になるので、
  // 比較対象は既定へ戻す。
  const choose = useCallback(
    (id: Pick) => {
      setPicked(id);
      if (against === id) setAgainst(undefined);
    },
    [against],
  );

  const nameOf = useCallback(
    (id: Pick): string => {
      if (id === null) return "いま";
      const version = list.find((v) => v.id === id);
      return version ? labelOf(version) : "失われたバージョン";
    },
    [list],
  );

  const stampOf = useCallback(
    (id: Pick): number =>
      id === null
        ? Number.POSITIVE_INFINITY
        : (list.find((v) => v.id === id)?.created_at ?? 0),
    [list],
  );

  // 既定の比較対象は「いま」。打つ前の書きかけがどう変わったかを最初に見せる。
  const other = against === undefined ? null : against;

  // 古いほうを変更前に置く。
  const order = useCallback(
    (a: Pick, b: Pick): [Pick, Pick] =>
      stampOf(a) >= stampOf(b) ? [b, a] : [a, b],
    [stampOf],
  );

  // 押した瞬間の値と、中身を組むための値を分ける。
  //
  // 本文や差分の組み立ては重い。同じ一枚でやると、React は組み終わるまで
  // コミットせず、ブラウザはコミットまで塗れない。左の一覧の選択も右上の
  // 見出しも、それが終わるまで変わらない。
  //
  // 前の中身を消すのも同じくらい重い（数百のブロックの片付け）。だから
  // 押した一枚では中身に触らず、上に覆いを重ねるだけにする。入れ替えは
  // 塗った後の一枚へ移す。
  const view = useMemo(
    () => ({ mode, layout, source, picked, other }),
    [mode, layout, source, picked, other],
  );
  const drawn = useAfterPaint(view);
  const shown = drawn ?? view;
  const pending = drawn !== view;

  const [oldId, newId] = order(picked, other);
  const [drawnOld, drawnNew] = order(shown.picked, shown.other);

  const oldText = useText(drawnOld, current);
  const newText = useText(drawnNew, current);
  const pickedText = useText(shown.picked, current);

  // 覆いを外すのは、組む値が追いつき、その本文も読めてから。先に外すと
  // 読み込みの一言が 1 枚だけ挟まって点滅する。
  const loading =
    shown.mode === "body"
      ? pickedText === undefined
      : oldText === undefined || newText === undefined;

  // 変更の規模。ソースの行数で数えるので、組版で見ていても同じ数字が出る。
  const stat = useMemo(
    () => (oldText != null && newText != null ? lineDiff(oldText, newText) : null),
    [oldText, newText],
  );

  // 変更箇所の送り。印を付けた要素をスクロールする入れ物から拾う。
  const scroller = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(-1);
  const [spots, setSpots] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    setSpots(el ? el.querySelectorAll("[data-mg-change]").length : 0);
    setAt(-1);
  }, [pending, shown, oldText, newText]);

  const jump = useCallback(
    (dir: 1 | -1) => {
      const el = scroller.current;
      if (!el) return;
      const found = el.querySelectorAll<HTMLElement>("[data-mg-change]");
      if (found.length === 0) return;
      const next = (at + dir + found.length) % found.length;
      setAt(next);
      found[next].scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [at],
  );

  const style = useMemo(() => ({ fontFamily: fontStack(font) }), [font]);
  const ctx = useMemo(
    () => ({
      onNavigate: () => {},
      resolveAsset: (src: string) => resolveAsset(path, src),
      peekAsset: (src: string) => peekAsset(path, src),
      docPath: path,
    }),
    [path, resolveAsset, peekAsset],
  );

  // 過去のバージョンでファイルを置き換える。今の本文はバージョンとして
  // 残るので、押したあとでも元へ戻せる。
  const restore = useCallback(
    async (version: ReviewVersion) => {
      if (running.current || !abs || current === undefined) return;
      const name = labelOf(version);
      const ok = await confirm(
        `「${name}」の本文でこのファイルを置き換えます。今の本文はバージョンとして履歴に残ります。`,
        { title: "fude", kind: "warning" },
      );
      if (!ok) return;
      running.current = true;
      setRestoring(version.id);
      try {
        const done = await restoreVersion(abs, version.id, current);
        if (!done) return;
        await reloadFile(path);
        await syncLedger(store);
        setAgainst(undefined);
        notify(store, `「${name}」に戻しました`, "center", {
          label: "元に戻す",
          run: () => {
            void (async () => {
              if (!(await restoreVersion(abs, done.backup, done.text))) return;
              await reloadFile(path);
              await syncLedger(store);
              notify(store, "復元を取り消しました");
            })();
          },
        });
      } finally {
        running.current = false;
        setRestoring(null);
      }
    },
    [abs, current, path, reloadFile, store],
  );

  const parts = path.split("/");
  const name = parts.pop() ?? path;
  const dir = parts.join("/");

  return (
    <div className="mg-review flex h-screen w-screen flex-col overflow-hidden bg-[var(--mg-bg)] text-[var(--mg-fg)]">
      <header className="mg-review-head flex h-14 shrink-0 items-center gap-3 px-5">
        <Icon name="history" size={20} className="text-[var(--mg-accent)]" />
        <div className="min-w-0">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-[var(--mg-muted)]">
            Versions
          </div>
          <div className="truncate text-[13px] font-medium leading-tight" title={path}>
            {name}
            {dir && (
              <span className="ml-1.5 text-[11px] text-[var(--mg-muted)]">{dir}</span>
            )}
          </div>
        </div>
        <span className="flex-1" />

        {list.length > 0 && (
          <div className="mg-ver-seg">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={mode === m.id ? "is-on" : undefined}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {list.length > 0 && mode === "diff" && (
          <>
            <Against
              label={nameOf(other)}
              options={list}
              current={other}
              exclude={picked}
              onPick={setAgainst}
            />
            <button
              onClick={() => setSource((v) => !v)}
              title="Markdown のまま比べる"
              className={`mg-ver-flag${source ? " is-on" : ""}`}
            >
              <Icon name="code" size={15} />
              ソース
            </button>
            <div className="mg-ver-seg">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLayout(l.id)}
                  className={layout === l.id ? "is-on" : undefined}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </>
        )}

        <button
          onClick={() => close(null)}
          className="flex items-center gap-1 rounded-lg border border-[var(--mg-border)] px-2.5 py-1 text-[12px] text-[var(--mg-fg-dim)] transition duration-100 active:scale-95 hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          <Icon name="close" size={15} />
          閉じる
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-[19rem] shrink-0 overflow-y-auto border-r border-[var(--mg-border)] bg-[var(--mg-panel)]">
          {list.map((version) => {
            const actor = actorOf(version);
            return (
              <button
                key={version.id}
                onClick={() => choose(version.id)}
                title={fullyOf(version)}
                className={`mg-ver-row${picked === version.id ? " is-active" : ""}`}
              >
                <span className={`mg-ver-face is-${actor}`}>
                  <Icon name={ACTOR_ICON[actor]} size={13} fill />
                </span>
                <span className="mg-ver-main">
                  <span className="mg-ver-name">{whenOf(version)}</span>
                  <span className="mg-ver-note">{noteOf(version)}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* いま何を見ているか。押した瞬間の値から出すので、中身が組み
              終わるのを待たずに変わる。 */}
          {list.length > 0 && (
            <div className="mg-ver-facing">
              {mode === "body" ? (
                <Facing id={picked} list={list} />
              ) : (
                <>
                  <Facing id={oldId} list={list} />
                  <Icon name="arrow_forward" size={14} className="shrink-0" />
                  <Facing id={newId} list={list} />
                </>
              )}
              {mode === "diff" && stat && (
                <>
                  <Stat added={stat.added} removed={stat.removed} />
                  {spots > 0 && (
                    <span className="mg-ver-hop">
                      <button onClick={() => jump(-1)} title="前の変更へ">
                        <Icon name="keyboard_arrow_up" size={16} />
                      </button>
                      <span>{at < 0 ? `${spots} 箇所` : `${at + 1} / ${spots}`}</span>
                      <button onClick={() => jump(1)} title="次の変更へ">
                        <Icon name="keyboard_arrow_down" size={16} />
                      </button>
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          <div className="relative flex min-h-0 flex-1">
            <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
              {/* ソースは等幅を左右に並べるので、読み物の幅では収まらない。 */}
              <div
                className={`mx-auto px-6 py-6 ${
                  shown.mode === "diff" && shown.source ? "max-w-none" : "max-w-5xl"
                }`}
              >
                {current === undefined ? (
                  <Waiting>本文を読み込んでいます…</Waiting>
                ) : list.length === 0 ? (
                  <p className="mg-ver-note-line">
                    <Icon name="save_as" size={15} />
                    この文書にはまだバージョンがありません。本文の画面の「バージョンを保存」から打てます。
                  </p>
                ) : shown.mode === "body" ? (
                  pickedText === undefined ? (
                    <Waiting>読み込んでいます…</Waiting>
                  ) : pickedText === null ? (
                    <Lost>このバージョンの本文が見つかりません。</Lost>
                  ) : (
                    <markdownContext.Provider value={ctx}>
                      <Body
                        text={pickedText}
                        editorial={editorial}
                        style={style}
                        width={width}
                      />
                    </markdownContext.Provider>
                  )
                ) : oldText === undefined || newText === undefined ? (
                  <Waiting>読み込んでいます…</Waiting>
                ) : oldText === null || newText === null ? (
                  <Lost>比べるバージョンの本文が見つかりません。</Lost>
                ) : shown.source ? (
                  stat && <SourceDiff diff={stat} layout={shown.layout} />
                ) : (
                  <markdownContext.Provider value={ctx}>
                    <VersionDiff
                      key={`${drawnOld ?? "now"}:${drawnNew ?? "now"}`}
                      base={oldText}
                      head={newText}
                      layout={shown.layout}
                      editorial={editorial}
                      style={style}
                    />
                  </markdownContext.Provider>
                )}
              </div>
            </div>

            {/* 組み替えのあいだ重ねる覆い。中身と入れ替えると、押した一枚で
                前の中身の片付けまで走る。重ねる先はスクロールする要素の外側
                （中に置くと、下まで送っていたときに覆いが上端へ行って
                見えない）。 */}
            {(pending || loading) && (
              <div className="absolute inset-0 z-10 bg-[var(--mg-bg)] px-6 py-6">
                <Waiting>読み込んでいます…</Waiting>
              </div>
            )}
          </div>
        </div>

        {picked !== null && (
          <aside className="mg-ver-act">
            <button
              onClick={() => {
                const version = list.find((v) => v.id === picked);
                if (version) void restore(version);
              }}
              disabled={restoring !== null || current === undefined}
              className="mg-act is-done"
            >
              <Icon
                name={restoring === picked ? "progress_activity" : "restore"}
                size={14}
                className={restoring === picked ? "mg-spin" : undefined}
              />
              このバージョンを復元
            </button>
          </aside>
        )}
      </div>
    </div>
  );
}

// 変更の規模。数だけでは大きさが掴めないので、追加と削除の比率を細い帯で添える。
function Stat({ added, removed }: { added: number; removed: number }) {
  const total = added + removed;
  if (total === 0) return null;
  return (
    <span className="mg-ver-stat">
      <span className="is-add">＋{added}</span>
      <span className="is-del">−{removed}</span>
      <span className="mg-ver-bar">
        <i style={{ width: `${(added / total) * 100}%` }} />
      </span>
    </span>
  );
}

// 見出しに出すバージョンの呼び名。日時と、主体・名前を添える。
function Facing({ id, list }: { id: Pick; list: ReviewVersion[] }) {
  const version = id === null ? null : list.find((v) => v.id === id);
  if (!version) {
    return <span className="mg-ver-facing-name">{id === null ? "いま" : "失われたバージョン"}</span>;
  }
  return (
    <span className="min-w-0 truncate">
      <span className="mg-ver-facing-name">{whenOf(version)}</span>
      <span className="mg-ver-facing-note">{noteOf(version)}</span>
    </span>
  );
}

function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <p className="mg-ver-note-line">
      <Icon name="progress_activity" size={14} className="mg-spin" />
      {children}
    </p>
  );
}

function Lost({ children }: { children: React.ReactNode }) {
  return (
    <p className="mg-ver-note-line">
      <Icon name="error" size={15} />
      {children}
    </p>
  );
}

// 差分の比較対象を選ぶ。
function Against({
  label,
  options,
  current,
  exclude,
  onPick,
}: {
  label: string;
  options: ReviewVersion[];
  current: Pick;
  // 両側に同じものを置くと差分が空になるので、いま見ているバージョンは出さない。
  exclude: Pick;
  onPick: (id: Pick) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (id: Pick) => {
    onPick(id);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="mg-ver-pick">
        <span className="text-[var(--mg-muted)]">比較対象</span>
        <span className="truncate font-medium">{label}</span>
        <Icon name="unfold_more" size={15} className="text-[var(--mg-muted)]" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] p-1.5 shadow-2xl">
          {exclude !== null && (
            <button
              onClick={() => pick(null)}
              className={`mg-ver-opt${current === null ? " is-on" : ""}`}
            >
              いま
            </button>
          )}
          {options
            .filter((v) => v.id !== exclude)
            .map((v) => (
              <button
                key={v.id}
                onClick={() => pick(v.id)}
                className={`mg-ver-opt${current === v.id ? " is-on" : ""}`}
              >
                <span className="shrink-0">{whenOf(v)}</span>
                <span className="truncate text-[11px] text-[var(--mg-muted)]">
                  {noteOf(v)}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// バージョンの本文を読む。「いま」は本文キャッシュから、それ以外は
// スナップショットから。undefined は読み込み中、null は本文が見つからない。
function useText(id: Pick, current: string | undefined): string | null | undefined {
  // どのバージョンの本文かを一緒に持つ。持たないと、選び替えた直後の一枚で
  // 前のバージョンの本文をそのまま出してしまう。
  const [got, setGot] = useState<{ id: string; text: string | null } | null>(null);
  useEffect(() => {
    if (id === null) return;
    let alive = true;
    void readVersion(id).then((text) => {
      if (alive) setGot({ id, text });
    });
    return () => {
      alive = false;
    };
  }, [id]);
  // 「いま」は控えを持たず、そのつど本文キャッシュから読む。バージョンと違って
  // 書き換わるので、控えると監視の取り込みに追いつかない。
  if (id === null) return current ?? null;
  return got?.id === id ? got.text : undefined;
}

// 最初の一塊。ここを大きくすると、押してから何かが出るまでの間が伸びる。
const FIRST_CHUNK = 12;
// 残りを足す 1 回分。
const NEXT_CHUNK = 160;

// バージョンの本文をそのまま出す。閲覧専用。
//
// 入れ物は読む画面と同じ形にする。1 つの mg-prose の中にブロックを並べ、
// 入れ物の display は contents にする。ブロックごとに mg-prose を作ると、
// prose の first-child リセットが毎ブロックに効いて見出しの上の余白が消え、
// 段落と見出しの縦のリズムが崩れる。
//
// 先頭から順に足していく。全ブロックを 1 回のペイントで描くと大きな
// ファイルで固まる。
function Body({
  text,
  editorial,
  style,
  width,
}: {
  text: string;
  editorial: boolean;
  style: React.CSSProperties;
  width: string;
}) {
  const blocks = useMemo(() => splitBlocks(parseFrontmatter(text).body), [text]);
  const [limit, setLimit] = useState(FIRST_CHUNK);

  useEffect(() => setLimit(FIRST_CHUNK), [text]);
  useEffect(() => {
    if (limit >= blocks.length) return;
    const frame = requestAnimationFrame(() => setLimit((n) => n + NEXT_CHUNK));
    return () => cancelAnimationFrame(frame);
  }, [limit, blocks.length]);

  if (blocks.length === 0) {
    return <p className="mg-ver-note-line">このバージョンの本文は空です。</p>;
  }

  return (
    <>
      <article
        style={style}
        className={`mg-prose prose ${editorial ? "mg-editorial" : ""} ${
          WIDTH_CLASS[width]
        } mx-auto`}
      >
        {blocks.slice(0, limit).map((block) => (
          <div key={block.index} className="mg-block">
            <Markdown body={block.src} editorial={editorial} />
          </div>
        ))}
      </article>
      {limit < blocks.length && (
        <p className="mg-ver-note-line">
          残り {blocks.length - limit} ブロックを読み込んでいます…
        </p>
      )}
    </>
  );
}
