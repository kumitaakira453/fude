import { message } from "@tauri-apps/plugin-dialog";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sectionPathAt, splitBlocks, type Block } from "../lib/blocks";
import { readSelection, type BlockSelection } from "../lib/domText";
import {
  anchorStateOf,
  createThread,
  isOpen,
  REVIEW_AUTHOR,
  type AnchorHit,
  type AnchorState,
  type ReviewThread,
} from "../lib/review";
import {
  ledgerAtom,
  refreshLedger,
  reviewScreenAtom,
  reviewThreadAtom,
} from "../state/review";

// 読書ビューのレビュー機能。選択した箇所に指摘を書くところまでを持つ。
// 付いている指摘を読む・返信する・解決するのはレビュー画面が受け持つ。

interface Draft {
  hit: AnchorHit;
  offset: number;
  text: string;
  quote: string;
  sectionPath: string[];
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
    if (blocksRef.current?.body !== body) {
      blocksRef.current = { body, blocks: splitBlocks(body) };
    }
    return blocksRef.current.blocks;
  }, [body]);

  const blocks = useMemo(
    () => (threads.length > 0 ? getBlocks() : []),
    [threads.length, getBlocks],
  );

  const anchorOf = useCallback(
    (thread: ReviewThread): AnchorState => anchorStateOf(thread, body),
    [body],
  );

  useEffect(() => {
    if (!content || !isActive) {
      setSelection(null);
      return;
    }
    let raf = 0;
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setSelection(readSelection(content)));
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [content, isActive]);

  useEffect(() => {
    setDraft(null);
    setSelection(null);
  }, [absPath]);

  const close = useCallback(() => setDraft(null), []);

  // 本文に付いている印を押したら、その指摘をレビュー画面で開く。
  const inspect = useCallback(
    (hit: AnchorHit) => {
      setSelectedThread(hit.id);
      setScreen(true);
    },
    [setSelectedThread, setScreen],
  );

  // 押しても何も起きない状態を作らない。進めない理由はその場で出す。
  const startDraft = useCallback(() => {
    if (!selection) {
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
    const block = all.find((b) => b.index === selection.blockIndex);
    if (!block) {
      void message(
        `選択された箇所（ブロック ${selection.blockIndex} / 全 ${all.length}）を本文の中で特定できませんでした。`,
        { title: "mdglow", kind: "error" },
      );
      return;
    }
    setDraft({
      hit: {
        id: "",
        top: selection.rect.top,
        bottom: selection.rect.bottom,
        left: selection.rect.left,
      },
      offset: selection.start,
      text: selection.text,
      quote: block.src,
      sectionPath: sectionPathAt(all, selection.blockIndex),
    });
    setSelection(null);
  }, [selection, absPath, getBlocks]);

  const submit = useCallback(
    async (text: string) => {
      if (!draft || !absPath || busy) return;
      setBusy(true);
      try {
        const id = await createThread({
          file: absPath,
          quote: draft.quote,
          selection: draft.text,
          selectionOffset: draft.offset,
          sectionPath: draft.sectionPath,
          // 画面に出ていた全文を版として残す。ディスクの内容ではなくこれを
          // 渡すので、指摘とその基準版が食い違わない。
          source: raw ?? body,
          author: REVIEW_AUTHOR,
          body: text,
        });
        if (id) {
          await refreshLedger(store);
          setDraft(null);
        }
      } finally {
        setBusy(false);
      }
    },
    [draft, absPath, busy, raw, body, store],
  );

  return {
    threads,
    blocks,
    anchorOf,
    selection,
    draft,
    busy,
    startDraft,
    inspect,
    submit,
    close,
  };
}
