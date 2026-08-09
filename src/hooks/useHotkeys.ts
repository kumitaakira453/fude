import { useStore } from "jotai";
import { useEffect } from "react";
import { splitPane } from "../lib/ui";
import * as A from "../state/atoms";

export function useHotkeys() {
  const store = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        store.set(A.paletteOpenAtom, !store.get(A.paletteOpenAtom));
      } else if (mod && e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        store.set(A.sidebarOpenAtom, true);
        store.set(A.sidebarTabAtom, "search");
      } else if (mod && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        store.set(A.sidebarOpenAtom, !store.get(A.sidebarOpenAtom));
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        splitPane(store, "row");
      } else if (mod && e.key === "[") {
        e.preventDefault();
        history.back();
      } else if (mod && e.key === "]") {
        e.preventDefault();
        history.forward();
      } else if (e.key === "Escape") {
        store.set(A.paletteOpenAtom, false);
        store.set(A.highlightAtom, null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}
