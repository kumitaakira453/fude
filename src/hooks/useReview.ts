import { message } from "@tauri-apps/plugin-dialog";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resplitBlocks,
  sectionPathAt,
  splitBlocks,
  type Block,
} from "../lib/blocks";
import {
  diffBlocks,
  headOf,
  resolveInDiff,
  type BlockChange,
  type Resolution,
} from "../lib/blockDiff";
import { readSelection, type BlockSelection } from "../lib/domText";
import { notify } from "../state/toast";
import { parseFrontmatter } from "../lib/frontmatter";
import {
  createThread,
  isOpen,
  readVersion,
  REVIEW_AUTHOR,
  setResolved,
  type AnchorHit,
} from "../lib/review";
import {
  ledgerAtom,
  syncLedger,
  reviewScreenAtom,
  reviewThreadAtom,
} from "../state/review";

// 読書ビューのレビュー機能。選択した箇所に指摘を書くところまでを持つ。
// 付いている指摘を読む・返信する・解決するのはレビュー画面が受け持つ。

interface Draft {
  hit: AnchorHit;
  // 下書き中の対象を本文に印で出すための位置。
  blockIndex: number;
  offset: number;
  text: string;
  quote: string;
  sectionPath: string[];
  // ブロック全体への指摘。箇所を持たないので、保存する選択は空にする。
  whole?: boolean;
}

export function useReview({
  absPath,
  body,
  raw,
  content,
  isActive,
}: {
  absPath: string | null;
  body: string;
  raw: string | undefined;
  content: HTMLElement | null;
  isActive: boolean;
}) {
  const store = useStore();
  const ledger = useAtomValue(ledgerAtom);
  const setScreen = useSetAtom(reviewScreenAtom);
  const setSelectedThread = useSetAtom(reviewThreadAtom);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selection, setSelection] = useState<BlockSelection | null>(null);
  const [busy, setBusy] = useState(false);

  const threads = useMemo(
    () => (absPath ? ledger.threads.filter((t) => t.file === absPath && isOpen(t)) : []),
    [ledger, absPath],
  );

  // ブロック分割は指摘があるファイルと、指摘を付ける瞬間だけ行う。
  // 大半のファイルには指摘が無いので、開くときの負荷を増やさない。
  const blocksRef = useRef<{ body: string; blocks: Block[] } | null>(null);
  const getBlocks = useCallback((): Block[] => {
    const prev = blocksRef.current;
    if (prev?.body !== body) {
      // 2 回目以降は、直前の割り方を土台に書き換わった周りだけ parse し直す。
      // 指摘があるファイルでは本文が変わるたびに通るので、全文 parse は重い。
      const blocks = prev
        ? resplitBlocks(prev.body, prev.blocks, body)
        : splitBlocks(body);
      blocksRef.current = { body, blocks };
      return blocks;
    }
    return prev.blocks;
  }, [body]);

  // 指摘の現在位置は、基準版のブロックから対応付けで導出する。現在の本文から
  // 引用文字列を探す方法は、指摘に応えて本文が書き換えられた瞬間に失敗する。
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());

  useEffect(() => {
    if (threads.length === 0) {
      setResolutions(new Map());
      return;
    }
    let alive = true;
    void (async () => {
      const head = getBlocks();
      const ids = [...new Set(threads.map((t) => t.base_version))].filter(Boolean);
      const texts = new Map<string, string | null>();
      for (const id of ids) texts.set(id, await readVersion(id));
      if (!alive) return;

      // 同じ基準版を参照する指摘は差分を共有する
      const diffs = new Map<string, BlockChange[]>();
      const next = new Map<string, Resolution>();
      for (const thread of threads) {
        const baseText = texts.get(thread.base_version);
        if (baseText == null) {
          next.set(thread.id, { state: "unknown", index: -1 });
          continue;
        }
        let diff = diffs.get(thread.base_version);
        if (!diff) {
          diff = diffBlocks(splitBlocks(parseFrontmatter(baseText).body), head);
          diffs.set(thread.base_version, diff);
        }
        next.set(thread.id, resolveInDiff(diff, thread.quote, thread.selection));
      }
      if (alive) setResolutions(next);
    })();
    return () => {
      alive = false;
    };
  }, [threads, getBlocks]);

  // 解決結果を台帳に控える。CLI は Markdown を解析しないのでこれを読ませる。
  // 同じ内容を書き直して無駄にロックを取らないよう、送った分を覚えておく。
  const sentRef = useRef(new Map<string, string>());
  useEffect(() => {
    for (const thread of threads) {
      const resolution = resolutions.get(thread.id);
      if (!resolution) continue;
      const headQuote = headOf(resolution)?.src ?? "";
      const signature = `${resolution.state}\u0000${headQuote}`;
      if (sentRef.current.get(thread.id) === signature) continue;
      if (
        thread.resolved?.state === resolution.state &&
        thread.resolved?.head_quote === headQuote
      ) {
        sentRef.current.set(thread.id, signature);
        continue;
      }
      sentRef.current.set(thread.id, signature);
      void setResolved(thread.id, resolution.state, headQuote);
    }
  }, [resolutions, threads]);

  useEffect(() => {
    if (!content || !isActive) {
      setSelection(null);
      return;
    }
    let raf = 0;
    // 引いているあいだは控えを更新しない。伸ばしている選択のすぐ下に
    // メニューが出ると、そのままドラッグの行き先を奪って選択が飛ぶ。
    let drawing = false;
    const read = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setSelection(readSelection(content)));
    };
    const onChange = () => {
      if (drawing) return;
      read();
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      drawing = true;
      cancelAnimationFrame(raf);
      setSelection(null);
    };
    const onUp = () => {
      if (!drawing) return;
      drawing = false;
      read();
    };
    document.addEventListener("selectionchange", onChange);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", onChange);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, [content, isActive]);

  useEffect(() => {
    setDraft(null);
    setSelection(null);
  }, [absPath]);

  const close = useCallback(() => setDraft(null), []);

  // 選択の控えを即座に落とす。selectionchange は 1 フレーム遅れて届くので、
  // 選択を解いた操作の側からも落として、メニューを残さない。
  const clearSelection = useCallback(() => setSelection(null), []);

  // 本文に付いている印を押したら、その指摘をレビュー画面で開く。
  const inspect = useCallback(
    (hit: AnchorHit) => {
      setSelectedThread(hit.id);
      setScreen(true);
    },
    [setSelectedThread, setScreen],
  );

  // 押しても何も起きない状態を作らない。進めない理由はその場で出す。
  const startDraft = useCallback((opts?: { whole?: boolean }) => {
    // 読むのは DOM が今持っている選択。控え（selection）は selectionchange
    // 経由で 1 フレーム遅れて届くので、セルやブロック全体へ選択を広げた直後に
    // これを先に見ると、広げる前の一部分だけを対象にしてしまう。
    // 押した拍子に選択が解けている場合だけ控えに戻る。
    const picked = (content ? readSelection(content) : null) ?? selection;
    if (!picked) {
      void message("本文を選択してから押してください。", {
        title: "mdglow",
        kind: "info",
      });
      return;
    }
    if (!absPath) {
      void message("ファイルの場所を特定できませんでした。フォルダを開き直してください。", {
        title: "mdglow",
        kind: "error",
      });
      return;
    }
    const all = getBlocks();
    const block = all.find((b) => b.index === picked.blockIndex);
    if (!block) {
      void message(
        `選択された箇所（ブロック ${picked.blockIndex} / 全 ${all.length}）を本文の中で特定できませんでした。`,
        { title: "mdglow", kind: "error" },
      );
      return;
    }
    setDraft({
      hit: {
        id: "",
        top: picked.rect.top,
        bottom: picked.rect.bottom,
        left: picked.rect.left,
      },
      blockIndex: picked.blockIndex,
      offset: picked.start,
      text: picked.text,
      quote: block.src,
      sectionPath: sectionPathAt(all, picked.blockIndex),
      whole: opts?.whole,
    });
    setSelection(null);
  }, [selection, content, absPath, getBlocks]);

  const submit = useCallback(
    async (text: string) => {
      if (!draft || !absPath || busy) return;
      setBusy(true);
      try {
        const id = await createThread({
          file: absPath,
          quote: draft.quote,
          // ブロック全体への指摘は箇所を持たない。空で保存すると、印は
          // ブロックの外枠だけになる（塗り潰さない）。
          selection: draft.whole ? "" : draft.text,
          selectionOffset: draft.whole ? 0 : draft.offset,
          sectionPath: draft.sectionPath,
          // 画面に出ていた全文を版として残す。ディスクの内容ではなくこれを
          // 渡すので、指摘とその基準版が食い違わない。
          source: raw ?? body,
          author: REVIEW_AUTHOR,
          body: text,
        });
        if (id) {
          await syncLedger(store);
          setDraft(null);
          // この操作はレビュー画面の外（本文の上）で行うので、右下でも何とも重ならない。
          notify(store, "指摘しました", "right");
        }
      } finally {
        setBusy(false);
      }
    },
    [draft, absPath, busy, raw, body, store],
  );

  return {
    threads,
    resolutions,
    selection,
    draft,
    busy,
    startDraft,
    inspect,
    submit,
    close,
    clearSelection,
  };
}
