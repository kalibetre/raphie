import { createHash } from "node:crypto";

import { authMark, authStyles } from "./auth-pages.ts";

const script = `
  const secret = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(null, '', location.pathname);
  const form = document.querySelector('form');
  const button = document.querySelector('button');
  const error = document.querySelector('[role="alert"]');
  document.querySelector('[data-origin]').textContent = location.origin;
  if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    error.textContent = 'This pairing link is invalid. Generate a new one on the server.';
    button.disabled = true;
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!secret) return;
    button.disabled = true;
    error.textContent = '';
    try {
      const response = await fetch('/auth/pairing/redeem', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret, label: document.querySelector('#device-label').value })
      });
      if (!response.ok) throw new Error();
      location.replace('/');
    } catch {
      error.textContent = 'Could not pair this browser. Check the link or generate a new one.';
      button.disabled = false;
    }
  });
`;

export function pairingPage(): Response {
  const digest = createHash("sha256").update(script).digest("base64");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pair browser · Raphie</title><style>${authStyles}</style></head><body><main class="shell"><div class="wrap"><div class="brand">${authMark}<span>raphie</span></div><section class="card"><h1>Pair this browser</h1><p>Connect this browser to <strong data-origin></strong>. Only continue if you created this pairing link yourself.</p><form><div class="field"><label for="device-label">Device name</label><input id="device-label" name="label" maxlength="80" value="Browser" required autocomplete="off"></div><p role="alert"></p><button type="submit">Pair browser</button></form></section></div></main><script>${script}</script></body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${digest}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}

export function pairingInstructionsPage(): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect to Raphie</title><style>${authStyles}</style></head><body><main class="shell"><div class="wrap"><div class="brand">${authMark}<span>raphie</span></div><section class="card"><h1>Connect this device</h1><p>On the machine running Raphie, run <strong>sudo raphie pair</strong>. Open the link or scan the QR code to connect this device.</p></section></div></main></body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}
