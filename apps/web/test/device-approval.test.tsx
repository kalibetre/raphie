import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DeviceApproval } from "../src/presentation/auth/device-approval";

test("a prefilled device code still requires review before approval", () => {
  const html = renderToStaticMarkup(<DeviceApproval initialCode="ABCD2345" />);
  expect(html).toContain('for="device-code"');
  expect(html).toContain('value="ABCD2345"');
  expect(html).toContain("Continue");
  expect(html).not.toContain("Approve device");
});
