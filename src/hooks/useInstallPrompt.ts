import { useEffect, useState } from "react";

// beforeinstallprompt をモジュールレベルで捕捉し、任意のタイミングでインストールを促す。
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function useInstallPrompt() {
  const [available, setAvailable] = useState(!!deferred);

  useEffect(() => {
    const l = () => setAvailable(!!deferred);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    setAvailable(false);
  };

  return { available, install };
}
