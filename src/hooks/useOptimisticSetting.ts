import { startTransition, useEffect, useState } from "react";

// 表示設定のボタンを楽観的更新にする。押した瞬間に選択状態を切り替え、
// 実際の反映（テーマ変更に伴う全体の再描画など）は低優先度で流す。
// 反映が終わったら atom の値に戻す（外部から変更された場合にも追随する）。
export function useOptimisticSetting<T>(
  value: T,
  setValue: (v: T) => void,
): [T, (v: T) => void] {
  const [pending, setPending] = useState<T | null>(null);
  useEffect(() => {
    setPending(null);
  }, [value]);
  const choose = (v: T) => {
    setPending(v);
    startTransition(() => setValue(v));
  };
  return [pending ?? value, choose];
}
