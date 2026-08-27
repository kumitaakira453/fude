import { useStore } from "jotai";
import { useEffect } from "react";
import { refreshLedger } from "../state/review";

// レビューの台帳を読み込む。CLI（エージェント側）からも書き換わるため、
// ウィンドウにフォーカスが戻ったときに読み直す。これが無いと、返信や解決が
// 済んでいるのに古い画面を見て「何も起きていない」と受け取ってしまう。
export function useReviewLedger() {
  const store = useStore();

  useEffect(() => {
    void refreshLedger(store);
    const onFocus = () => void refreshLedger(store);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [store]);
}
