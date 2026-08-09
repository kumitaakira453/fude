import { useRef } from "react";

// IME 変換確定の Enter を「決定」と誤認しないためのガード。
// WebKit(Safari) では確定 Enter の e.isComposing が false になることがあるため、
// compositionstart/end を自前で追跡し、keyCode 229 も併せて判定する。
export function useImeSafeEnter() {
  const composing = useRef(false);
  return {
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      composing.current = false;
    },
    isComposing: (e: React.KeyboardEvent) =>
      composing.current ||
      e.nativeEvent.isComposing ||
      (e.nativeEvent as KeyboardEvent).keyCode === 229,
  };
}
