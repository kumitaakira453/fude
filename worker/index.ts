// Cloudflare Workers: Basic 認証ゲート付きで静的アセット(dist)を配信する。
// run_worker_first=true により全リクエストが先にこの Worker を通る。

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  BASIC_AUTH_USER?: string;
  BASIC_AUTH_PASS?: string;
}

function unauthorized(): Response {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="mdglow", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

// 定数時間比較（タイミング攻撃対策）
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i];
  return r === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const user = env.BASIC_AUTH_USER;
    const pass = env.BASIC_AUTH_PASS;

    // 認証情報が設定されている場合のみゲートを有効化する
    if (user && pass) {
      const header = request.headers.get("Authorization") ?? "";
      const [scheme, encoded] = header.split(" ");
      if (scheme !== "Basic" || !encoded) return unauthorized();

      let decoded: string;
      try {
        decoded = atob(encoded);
      } catch {
        return unauthorized();
      }
      const sep = decoded.indexOf(":");
      if (sep < 0) return unauthorized();
      const u = decoded.slice(0, sep);
      const p = decoded.slice(sep + 1);
      // 短絡評価を避けて両方を必ず比較
      const okUser = safeEqual(u, user);
      const okPass = safeEqual(p, pass);
      if (!okUser || !okPass) return unauthorized();
    }

    return env.ASSETS.fetch(request);
  },
};
