import { useEffect, useState } from "react";

// 真になったらすぐ真、偽になったら ms 待ってから偽を返す。
//
// 畳む動きのあいだ、消える側の中身を描き続けるために使う。
export function useLinger(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(on);
  useEffect(() => {
    if (on) {
      setShown(true);
      return;
    }
    const t = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(t);
  }, [on, ms]);
  return on || shown;
}
