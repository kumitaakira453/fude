import { useEffect, useState } from "react";
import { claudeSessionTalk, type Talk } from "../lib/claude";

// セッションの会話の頭と終わり（最初の依頼・最後の依頼・最後の返答）。
//
// 一覧を ↑↓ で送っている間などに読みに行かないよう、wait だけ待ってから読む。
// 読んだものは控え、次に同じ記録を出すときは控えを先に出してから読み直す
// （Rust 側が大きさと時刻で控えているので、変わっていなければ読み直しは軽い）。
const talks = new Map<string, Talk>();

export function useTalk(transcript: string | null | undefined, wait = 120): Talk | null {
  const [talk, setTalk] = useState<Talk | null>(() => (transcript ? (talks.get(transcript) ?? null) : null));
  useEffect(() => {
    setTalk(transcript ? (talks.get(transcript) ?? null) : null);
    if (!transcript) return;
    let live = true;
    const timer = window.setTimeout(() => {
      claudeSessionTalk(transcript).then(
        (t) => {
          talks.set(transcript, t);
          if (live) setTalk(t);
        },
        (e: unknown) => console.warn("会話を読めません", e),
      );
    }, wait);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [transcript, wait]);
  return talk;
}
