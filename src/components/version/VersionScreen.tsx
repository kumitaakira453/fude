import { confirm } from "@tauri-apps/plugin-dialog";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { splitBlocks } from "../../lib/blocks";
import { fontStack } from "../../lib/fonts";
import { parseFrontmatter } from "../../lib/frontmatter";
import { readVersion, restoreVersion, type ReviewVersion } from "../../lib/review";
import {
  ORIGIN_NOTE,
  actorOf,
  agoOf,
  labelOf,
  versionsOf,
} from "../../lib/versions";
import { contentCacheAtom, editorialAtom, fontAtom } from "../../state/atoms";
import { ledgerAtom, syncLedger, versionScreenAtom } from "../../state/review";
import { notify } from "../../state/toast";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";
import { markdownContext } from "../MarkdownContext";
import { VersionDiff, type Layout } from "./VersionDiff";

// 版の履歴。左に版を新しい順に並べ、右に選んだものを出す。
//
// 本文に重ねず別画面で出す。差分は前と後を並べて見せるものなので、
// 読む画面の幅には収まらない。
//
// いちばん上は「いま」。版ではなく今のファイルの本文で、差分の既定の相手にも
// なる。版を打つ前の書きかけをここで比べられる。

type Mode = "body" | "diff";

// 「いま」を表す選択。版 ID を持たないので null で表す。
type Pick = string | null;

const MODES: { id: Mode; label: string }[] = [
  { id: "body", label: "本文" },
  { id: "diff", label: "差分" },
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
  const close = useSetAtom(versionScreenAtom);
  const { absOf, reloadFile, resolveAsset, peekAsset } = useWorkspace();

  const abs = absOf(path);
  const current = cache.get(path);
  const list = useMemo(() => (abs ? versionsOf(ledger, abs) : []), [ledger, abs]);

  const [picked, setPicked] = useState<Pick>(null);
  // 既定は本文。選んだ版が実際どう見えるかを先に出し、差分は求められたら出す。
  const [mode, setMode] = useState<Mode>("body");
  const [layout, setLayout] = useState<Layout>("unified");
  // 差分の相手。undefined は「まだ選んでいない」で、既定に従う。
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

  // 選んでいた版が消えたら（別のウィンドウで台帳が変わった等）いまへ戻す。
  useEffect(() => {
    if (picked !== null && !list.some((v) => v.id === picked)) setPicked(null);
  }, [list, picked]);

  // 版を選ぶ。相手と同じものを選ぶと差分が空になるので、相手は既定へ戻す。
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
      return version ? labelOf(version) : "失われた版";
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

  // 既定の相手。過去の版を見ているならいまと比べ、いまを見ているなら
  // 直前の版と比べる。同じものを両側に置くと差分が空になる。
  const other =
    against === undefined
      ? picked === null
        ? (list[0]?.id ?? null)
        : null
      : against;
  // 古いほうを前に置く。
  const [oldId, newId] =
    stampOf(picked) >= stampOf(other) ? [other, picked] : [picked, other];

  const oldText = useText(oldId, current);
  const newText = useText(newId, current);
  const pickedText = useText(picked, current);
  const newestText = useText(list[0]?.id ?? null, current);

  const atNewest =
    list.length > 0 && newestText != null && newestText === current;

  const style = { fontFamily: fontStack(font) };
  const ctx = useMemo(
    () => ({
      onNavigate: () => {},
      resolveAsset: (src: string) => resolveAsset(path, src),
      peekAsset: (src: string) => peekAsset(path, src),
      docPath: path,
    }),
    [path, resolveAsset, peekAsset],
  );

  // 過去の版でファイルを置き換える。今の本文は版として残るので、
  // 押したあとでも元へ戻せる。
  const restore = useCallback(
    async (version: ReviewVersion) => {
      if (running.current || !abs || current === undefined) return;
      const name = labelOf(version);
      const ok = await confirm(
        `「${name}」の本文でこのファイルを置き換えます。今の本文は版として履歴に残ります。`,
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
        setPicked(null);
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
            {dir && <span className="ml-1.5 text-[11px] text-[var(--mg-muted)]">{dir}</span>}
          </div>
        </div>
        <span className="flex-1" />

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

        {mode === "diff" && (
          <>
            <Against
              label={nameOf(other)}
              options={list}
              current={other}
              exclude={picked}
              onPick={setAgainst}
            />
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
          className="flex items-center gap-1 rounded-lg border border-[var(--mg-border)] px-2.5 py-1 text-[12px] text-[var(--mg-fg-dim)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
        >
          <Icon name="close" size={15} />
          閉じる
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="mg-scroll-inset w-[19rem] shrink-0 overflow-y-auto border-r border-[var(--mg-border)] bg-[var(--mg-panel)]">
          <button
            onClick={() => choose(null)}
            className={`mg-ver-row${picked === null ? " is-active" : ""}`}
          >
            <span className="mg-ver-face">
              <Icon name="edit_note" size={13} fill />
            </span>
            <span className="mg-ver-main">
              <span className="mg-ver-name">いま</span>
              <span className="mg-ver-note">
                {list.length === 0
                  ? "まだ版がありません"
                  : atNewest
                    ? `「${labelOf(list[0])}」のまま`
                    : "まだ版にしていない"}
              </span>
            </span>
          </button>

          {list.map((version) => (
            <button
              key={version.id}
              onClick={() => choose(version.id)}
              className={`mg-ver-row${picked === version.id ? " is-active" : ""}`}
            >
              <span className={`mg-ver-face is-${actorOf(version.origin)}`}>
                <Icon
                  name={actorOf(version.origin) === "ai" ? "auto_awesome" : "person"}
                  size={13}
                  fill
                />
              </span>
              <span className="mg-ver-main">
                <span className="mg-ver-name">{labelOf(version)}</span>
                <span className="mg-ver-note">{ORIGIN_NOTE[version.origin]}</span>
              </span>
              <span className="mg-ver-when">{agoOf(version.created_at)}</span>
            </button>
          ))}
        </nav>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-6 py-6">
            {current === undefined ? (
              <p className="mg-ver-note-line">本文を読み込んでいます…</p>
            ) : list.length === 0 ? (
              <p className="mg-ver-note-line">
                <Icon name="bookmark_add" size={15} />
                この文書にはまだ版がありません。本文の画面の「版を保存」から打てます。
              </p>
            ) : mode === "body" ? (
              pickedText === undefined ? (
                <p className="mg-ver-note-line">版を読み込んでいます…</p>
              ) : pickedText === null ? (
                <p className="mg-ver-note-line">
                  <Icon name="error" size={15} />
                  この版の本文が見つかりません。
                </p>
              ) : (
                <markdownContext.Provider value={ctx}>
                  <Body text={pickedText} editorial={editorial} style={style} />
                </markdownContext.Provider>
              )
            ) : oldText === undefined || newText === undefined ? (
              <p className="mg-ver-note-line">版を読み込んでいます…</p>
            ) : oldText === null || newText === null ? (
              <p className="mg-ver-note-line">
                <Icon name="error" size={15} />
                比べる版の本文が見つかりません。
              </p>
            ) : (
              <>
                <p className="mg-ver-facing">
                  <span>{nameOf(oldId)}</span>
                  <Icon name="arrow_forward" size={14} />
                  <span>{nameOf(newId)}</span>
                </p>
                <markdownContext.Provider value={ctx}>
                  <VersionDiff
                    key={`${oldId ?? "now"}:${newId ?? "now"}`}
                    base={oldText}
                    head={newText}
                    layout={layout}
                    editorial={editorial}
                    style={style}
                  />
                </markdownContext.Provider>
              </>
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
              この版から復元
            </button>
          </aside>
        )}
      </div>
    </div>
  );
}

// 差分の相手を選ぶ。
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
  // 両側に同じものを置くと差分が空になるので、いま見ている版は出さない。
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
        <span className="text-[var(--mg-muted)]">相手</span>
        <span className="truncate font-medium">{label}</span>
        <Icon name="unfold_more" size={15} className="text-[var(--mg-muted)]" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 max-h-80 w-64 overflow-y-auto rounded-xl border border-[var(--mg-border)] bg-[var(--mg-panel)] p-1.5 shadow-2xl">
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
                <span className="truncate">{labelOf(v)}</span>
                <span className="ml-auto shrink-0 text-[11px] text-[var(--mg-muted)]">
                  {agoOf(v.created_at)}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// 版の本文を読む。「いま」は本文キャッシュから、それ以外はスナップショットから。
// undefined は読み込み中、null は本文が見つからない。
function useText(id: Pick, current: string | undefined): string | null | undefined {
  const [text, setText] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (id === null) return;
    let alive = true;
    setText(undefined);
    void readVersion(id).then((got) => {
      if (alive) setText(got);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  // 「いま」は控えを持たず、そのつど本文キャッシュから読む。版と違って
  // 書き換わるので、控えると監視の取り込みに追いつかない。
  return id === null ? (current ?? null) : text;
}

// 最初の一塊。ここを大きくすると、押してから何かが出るまでの間が伸びる。
const FIRST_CHUNK = 12;
// 残りを足す 1 回分。
const NEXT_CHUNK = 160;

// 版の本文をそのまま出す。閲覧専用。
//
// 先頭から順に足していく。全ブロックを 1 回のペイントで描くと大きな
// ファイルで固まる。
function Body({
  text,
  editorial,
  style,
}: {
  text: string;
  editorial: boolean;
  style: React.CSSProperties;
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
    return <p className="mg-ver-note-line">この版の本文は空です。</p>;
  }

  return (
    <div className="mg-doc">
      {blocks.slice(0, limit).map((block) => (
        <div
          key={block.index}
          className={`mg-prose prose ${editorial ? "mg-editorial" : ""}`}
          style={style}
        >
          <Markdown body={block.src} editorial={editorial} />
        </div>
      ))}
      {limit < blocks.length && (
        <p className="mg-ver-note-line">
          残り {blocks.length - limit} ブロックを読み込んでいます…
        </p>
      )}
    </div>
  );
}
