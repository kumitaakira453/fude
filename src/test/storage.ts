import { afterEach, beforeEach, vi } from "vitest";

// 控えの置き場所を、試験のあいだだけ用意する。
//
// Node 26 は localStorage を組み込みで持つが、--localstorage-file を渡さないと
// undefined のままになる。そちらが jsdom の localStorage を覆ってしまうので、
// 環境の指定に関わらず読めないことがある（同じワーカーで回すファイルの
// 組み合わせで変わる）。環境の当たり方で結果が変わらないよう、置き場所は
// 試験の側で作る。
//
// 読み書きと消すことしか使わないので、写しはそれだけを持つ。
export function useFakeStorage(): Map<string, string> {
  const box = new Map<string, string>();
  const shelf = {
    getItem: (key: string) => box.get(key) ?? null,
    setItem: (key: string, value: string) => void box.set(key, String(value)),
    removeItem: (key: string) => void box.delete(key),
    clear: () => box.clear(),
    key: (i: number) => [...box.keys()][i] ?? null,
    get length() {
      return box.size;
    },
  };

  beforeEach(() => {
    box.clear();
    vi.stubGlobal("localStorage", shelf);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    box.clear();
  });

  return box;
}
