import { glance } from "../../domains/settings/application/bot-glance.ts";

// These pages must render before the app and its assets are authenticated.
const avatar = glance("default");

export const authMark = `<svg viewBox="0 0 100 100" aria-hidden="true"><path fill="#b3ca9e" d="${avatar.path}"/>${avatar.eyes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6.5" fill="#28362b"/>`).join("")}</svg>`;

export const authStyles = `
  :root{color-scheme:light;--bg:#f7f5ef;--card:#fdfcf8;--text:#24231f;--muted:#6f6b61;--border:#dcd8cc;--soft:#efece4;--primary:#24231f;--on-primary:#f7f5ef;--accent:#4a7a57}
  @media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#1c1b18;--card:#24231f;--text:#ebe8df;--muted:#a29d91;--border:#444139;--soft:#2a2924;--primary:#ebe8df;--on-primary:#1c1b18;--accent:#7fb08b}}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:14px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  .shell{min-height:100vh;display:grid;place-items:center;padding:32px 20px}.wrap{width:min(100%,400px)}
  .brand{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;letter-spacing:-.04em;margin-bottom:32px}.brand svg{width:38px;height:38px}
  .card{border:1px solid var(--border);border-radius:16px;background:var(--card);padding:28px;box-shadow:0 1px 2px #2a24140a,0 8px 24px #2a24140d}
  h1{font-size:22px;line-height:1.2;letter-spacing:-.04em;margin:0;font-weight:650}p{line-height:1.55;color:var(--muted);margin:8px 0 24px}
  form{display:grid;gap:16px}.field{display:grid;gap:7px}label{font-weight:600;font-size:13px}input{width:100%;height:42px;padding:0 12px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:8px;font:inherit}
  input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button{height:42px;border:0;border-radius:8px;background:var(--primary);color:var(--on-primary);font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;margin-top:4px}button:hover{opacity:.88}
  .back{display:inline-block;margin-top:20px;color:var(--muted);text-decoration:none;font-size:13px}.back:hover{color:var(--text)}
  @media(max-width:480px){.shell{padding:24px 16px}.card{padding:24px 20px}.brand{margin-bottom:24px}}
`;
