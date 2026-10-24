import { expect, test } from "bun:test";

import { glance } from "../src/domains/settings/application/bot-glance";

test("each bot keeps its own stable face", () => {
  expect(glance("research-7")).toEqual(glance("research-7"));
  expect(glance("default").path).not.toBe(glance("research-7").path);
  for (const id of ["default", "a", "3d6504e7-9899-43d3-870e-9a3c6446f4c2"])
    for (const [x, y] of glance(id).eyes)
      // Eyes (r=6.5) stay inside the smallest possible blob radius (35.7).
      expect(Math.hypot(x - 50, y - 50) + 6.5).toBeLessThan(35.7);
});
