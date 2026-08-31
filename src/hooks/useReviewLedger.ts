import { useStore } from "jotai";
import { useEffect } from "react";
import { isLedgerChange, refreshLedger } from "../state/review";

// レビューの台帳を読み込む。CLI（エージェント側）と他のウィンドウからも
// 書き換わるため、次の 3 つの契機で読み直す。これが無いと、返信や解決が
// 済んでいるのに古い画面を見て「何も起きていない」と受け取ってしまう。
//
// - 起動時
// - ウィンドウにフォーカスが戻ったとき（CLI の書き込みを拾う）
// - 他のウィンドウが書き込んだとき（storage の印を拾う）
export function useReviewLedger() {
  const store = useStore();

  useEffect(() => {
    void refreshLedger(store);
    const reload = () => void refreshLedger(store);
    const onStorage = (e: StorageEvent) => {
      if (isLedgerChange(e)) reload();
    };
    window.addEventListener("focus", reload);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", reload);
      window.removeEventListener("storage", onStorage);
    };
  }, [store]);
}
