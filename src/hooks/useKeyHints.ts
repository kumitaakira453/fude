import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { hintsAtom } from "../state/workspaceBar";

// ⌘ だけを押したまましばらく待つと、キーを持つ部品（data-key）と札にキーを
// 重ねて出す。⌘S などを押す途中でちらっと出ないよう、少し待ってから出す。
// ⌘ を離す、ほかのキーを押す、窓を離れると消す。
const HINT_AFTER_MS = 300;

export function useKeyHints() {
  const setHints = useSetAtom(hintsAtom);
  useEffect(() => {
    let timer = 0;
    const html = document.documentElement;
    const hide = () => {
      window.clearTimeout(timer);
      delete html.dataset.hints;
      setHints(false);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Meta" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          html.dataset.hints = "";
          setHints(true);
        }, HINT_AFTER_MS);
      } else {
        hide();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") hide();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", hide);
      hide();
    };
  }, [setHints]);
}
