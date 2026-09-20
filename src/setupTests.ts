// 試験を走らせる前の地ならし。
//
// Node 26 は localStorage という名の入れ物を全体に置くが、起動の指定が無ければ
// 中身は undefined になる。それが jsdom の用意する入れ物を隠すので、覚えておく
// 類の設定（atomWithStorage）を触る試験が軒並み落ちる。中身だけ自前で置く。
if (typeof window !== "undefined" && !globalThis.localStorage) {
  const bag = new Map<string, string>();
  const shelf: Storage = {
    get length() {
      return bag.size;
    },
    clear: () => bag.clear(),
    getItem: (key) => bag.get(key) ?? null,
    key: (at) => [...bag.keys()][at] ?? null,
    removeItem: (key) => {
      bag.delete(key);
    },
    setItem: (key, value) => {
      bag.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shelf,
    configurable: true,
  });
}
