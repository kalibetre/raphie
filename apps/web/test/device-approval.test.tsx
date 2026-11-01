import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DeviceApproval } from "../src/presentation/auth/device-approval";

test("a device link is checked without an editable code step", () => {
  const html = renderToStaticMarkup(<DeviceApproval initialCode="ABCD2345" />);
  expect(html).toContain("Checking device request");
  expect(html).not.toContain("<input");
  expect(html).not.toContain("Continue");
  expect(html).not.toContain("Approve device");
});

test("a missing or malformed code asks the user to start from the device", () => {
  for (const initialCode of ["", "invalid code"]) {
    const html = renderToStaticMarkup(
      <DeviceApproval initialCode={initialCode} />,
    );
    expect(html).toContain("Open the approval link from your device");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Approve device");
  }
});
