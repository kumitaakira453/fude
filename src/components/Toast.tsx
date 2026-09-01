import { useAtom } from "jotai";
import { useEffect } from "react";
import { toastAtom } from "../state/toast";

const LINGER = 1900;
// 操作が付いているときは、押す間があるように長めに出す。
const LINGER_WITH_ACTION = 6000;

// 画面の下に短く出して自分で消える知らせ。操作の邪魔をしないよう、
// 押す対象は持たせず、本文の上にも重ねない位置に置く。
export function Toast() {
  const [toast, setToast] = useAtom(toastAtom);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast(null),
      toast.action ? LINGER_WITH_ACTION : LINGER,
    );
    return () => window.clearTimeout(timer);
    // id を見る。同じ文が続けて出たときも、そのつど数え直す。
  }, [toast?.id, toast, setToast]);

  if (!toast) return null;
  return (
    <div
      className={`mg-toast${toast.place === "right" ? " is-right" : ""}${
        toast.action ? " has-action" : ""
      }`}
      role="status"
      aria-live="polite"
      key={toast.id}
    >
      <span>{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="mg-toast-action"
          onClick={() => {
            toast.action?.run();
            setToast(null);
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
