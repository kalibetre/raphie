/**
 * Geometry for the "Glance" bot avatar in a 100×100 box: a lumpy blob and two
 * eyes looking one way. Everything derives from the bot id, so each bot keeps
 * the same face across sessions and browsers without storing anything.
 */
export function glance(id: string) {
  const next = random(
    id.split("").reduce((a, c) => (a * 131 + c.charCodeAt(0)) >>> 0, 17),
  );
  const turn = next() * 0.6;
  const points = Array.from({ length: 5 }, (_, i) => {
    const angle = (i / 5) * Math.PI * 2 + turn;
    const reach = 42 * (0.85 + next() * 0.3);
    return [50 + Math.cos(angle) * reach, 50 + Math.sin(angle) * reach];
  });
  const mid = (p: number[], q: number[]) =>
    `${round((p[0] + q[0]) / 2)} ${round((p[1] + q[1]) / 2)}`;
  let path = `M${mid(points[0], points[1])}`;
  for (let i = 1; i <= points.length; i++) {
    const p = points[i % points.length];
    const q = points[(i + 1) % points.length];
    path += `Q${round(p[0])} ${round(p[1])} ${mid(p, q)}`;
  }
  const look = next() * Math.PI * 2;
  const dx = round(Math.cos(look) * 7);
  const dy = round(Math.sin(look) * 5);
  return {
    path: `${path}Z`,
    eyes: [
      [39 + dx, 46 + dy],
      [61 + dx, 46 + dy],
    ] as const,
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** mulberry32: integer-only, so every JS engine draws the same face. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
