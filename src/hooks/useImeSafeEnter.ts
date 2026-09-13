import { useRef } from "react";

// IME 変換確定の Enter を「決定」と誤認しないためのガード。
//
// WebKit は確定に使った Enter の keydown を、変換が終わった**知らせのあと**に
// 寄こすことがある。そのときは composing も e.isComposing も false、keyCode も
// 13 なので、打鍵の中身だけでは新しい Enter と見分けが付かない。
//
// 確定に使った物理キーは、離すまで次の打鍵にならない。知らせを受けたら印を
// 立て、キーが離れるまでの 1 打を確定の分として捨てる。
export function useImeSafeEnter() {
  const composing = useRef(false);
  // 変換が終わった直後。確定に使ったキーが離れるまで立てておく。
  const ending = useRef(false);
  return {
    onCompositionStart: () => {
      composing.current = true;
      ending.current = false;
    },
    onCompositionEnd: () => {
      composing.current = false;
      ending.current = true;
    },
    // 確定に使ったキーが離れた。ここからは普段どおり受ける。
    onKeyUp: () => {
      ending.current = false;
    },
    isComposing: (e: React.KeyboardEvent) => {
      if (
        composing.current ||
        e.nativeEvent.isComposing ||
        (e.nativeEvent as KeyboardEvent).keyCode === 229
      ) {
        return true;
      }
      // 知らせのあとに届いた確定の打鍵。捨てるのは 1 回だけ（キーが離れる前に
      // 次の打鍵は来ない）。keyUp を繋いでいない入力欄でも、ここで戻る。
      if (ending.current) {
        ending.current = false;
        return true;
      }
      return false;
    },
  };
}
