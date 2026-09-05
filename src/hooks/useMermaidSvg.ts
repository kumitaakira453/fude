import { useEffect, useState } from "react";
import { renderMermaid } from "../lib/mermaid";

// mermaid のソースを SVG にする。構文が通らない間も直前に描けた図を残すので、
// 書いている途中で図が消えてちらつかない。delay を渡すと、その分だけ待って
// から描く（打つたびに描き直さない）。
export function useMermaidSvg(
  code: string,
  dark: boolean,
  delay = 0,
): { svg: string; error: string | null } {
  const [state, setState] = useState<{ svg: string; error: string | null }>({
    svg: "",
    error: null,
  });

  useEffect(() => {
    const trimmed = code.trim();
    if (!trimmed) {
      setState({ svg: "", error: null });
      return;
    }
    let alive = true;
    const run = () => {
      void renderMermaid(trimmed, dark)
        .then((svg) => {
          if (alive) setState({ svg, error: null });
        })
        .catch((e: { message?: string }) => {
          console.error("[fude mermaid]", e);
          if (alive) {
            setState((prev) => ({
              svg: prev.svg,
              error: String(e?.message || e),
            }));
          }
        });
    };
    if (delay <= 0) {
      run();
      return () => {
        alive = false;
      };
    }
    const t = window.setTimeout(run, delay);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [code, dark, delay]);

  return state;
}
