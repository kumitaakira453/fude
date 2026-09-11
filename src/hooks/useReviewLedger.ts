import { watch, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { useStore } from "jotai";
import { useEffect } from "react";
import { ledgerPath } from "../lib/review";
import { isLedgerChange, refreshLedger } from "../state/review";

// レビューの台帳を読み込む。CLI（エージェント側）と他のウィンドウからも
// 書き換わるため、次の 4 つの契機で読み直す。これが無いと、返信や解決が
// 済んでいるのに古い画面を見て「何も起きていない」と受け取ってしまう。
//
// - 起動時
// - 台帳のファイルが変わったとき（CLI の書き込みを、窓を触らずに拾う）
// - ウィンドウにフォーカスが戻ったとき（見張りに失敗したときの受け皿）
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

    // 台帳の見張り。見るのは置き場のフォルダで、ファイルそのものではない。
    // 書き込みは一時ファイルを置いてから置き換える（rename）ので、ファイルを
    // 見張ると差し替えた先を見失う。合図は数回来るので、間を置いて 1 回に
    // まとめる。
    let disposed = false;
    let unwatch: UnwatchFn | null = null;
    let timer: number | undefined;
    void ledgerPath()
      .then((path) =>
        watch(
          path.slice(0, path.lastIndexOf("/")),
          (event) => {
            if (disposed) return;
            if (!event.paths.some((p) => p.endsWith("/store.json"))) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(reload, 200);
          },
          { delayMs: 150 },
        ),
      )
      .then((fn) => {
        if (disposed) fn();
        else unwatch = fn;
      })
      .catch(() => {
        // まだ台帳が無いときは見張れない。フォーカスで読み直す道が残る。
      });

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unwatch?.();
      window.removeEventListener("focus", reload);
      window.removeEventListener("storage", onStorage);
    };
  }, [store]);
}
