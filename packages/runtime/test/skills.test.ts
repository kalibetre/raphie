import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { deflateRawSync } from "node:zlib";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import {
  checkFrontmatter,
  skillInstructions,
} from "../src/domains/skills/domain/skill.ts";
import { readZip } from "../src/domains/skills/infrastructure/archives.ts";
import {
  gitHubFiles,
  gitHubSource,
} from "../src/domains/skills/infrastructure/github-skills.ts";
import {
  frontmatter,
  skillsIn,
} from "../src/domains/skills/infrastructure/workspace-skills.ts";
import { chatModel } from "./chat-model.ts";

const skillMd = (name: string, description: string, body = "# Steps\n") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

/** A .zip holding `files`, deflated, as zip tools write one. */
function zip(files: Record<string, string>) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = encoder.encode(text);
    const data = new Uint8Array(deflateRawSync(raw));
    const nameBytes = encoder.encode(name);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, directory, true);
  ev.setUint32(16, offset, true);
  return new Uint8Array(
    Buffer.concat(
      [...locals, ...centrals, end].map((part) => Buffer.from(part)),
    ),
  );
}

test("a skill's frontmatter follows the Agent Skills rules", () => {
  const check = (folder: string, text: string) =>
    checkFrontmatter(folder, frontmatter(text));
  expect(check("pdf-tables", skillMd("pdf-tables", "Pull tables."))).toEqual({
    header: { name: "pdf-tables", description: "Pull tables." },
  });
  expect(check("x", "no frontmatter")).toHaveProperty("problem");
  expect(check("Bad", skillMd("Bad", "Upper case."))).toHaveProperty("problem");
  expect(check("a--b", skillMd("a--b", "Double hyphen."))).toHaveProperty(
    "problem",
  );
  expect(check("one", skillMd("two", "Wrong folder."))).toEqual({
    problem: "The name in SKILL.md (two) must match its folder (one).",
  });
  expect(check("x", "---\nname: x\n---\n")).toEqual({
    problem: "SKILL.md has no description.",
  });
  expect(check("x", skillMd("x", "y".repeat(1025)))).toHaveProperty("problem");
  // Sorted, so the instructions only change when the skills do.
  const listed = skillInstructions([
    { name: "zeta", description: "Last." },
    { name: "alpha", description: "First." },
  ]);
  expect(listed.indexOf("alpha")).toBeLessThan(listed.indexOf("zeta"));
  expect(skillInstructions([])).toBe("");
});

test("skills are found in a .zip, with or without their folder", () => {
  const nested = skillsIn(
    readZip(
      zip({
        "skills/weekly-report/SKILL.md": skillMd("weekly-report", "Report."),
        "skills/weekly-report/assets/template.md": "# Template",
        "__MACOSX/skills/weekly-report/._SKILL.md": "junk",
        "skills/weekly-report/.DS_Store": "junk",
      }),
    ),
  );
  expect([...nested.keys()]).toEqual(["weekly-report"]);
  expect([...nested.get("weekly-report")!.keys()].sort()).toEqual([
    "SKILL.md",
    "assets/template.md",
  ]);
  const bare = skillsIn(
    readZip(zip({ "SKILL.md": skillMd("lone-skill", "Alone.") })),
  );
  expect([...bare.keys()]).toEqual(["lone-skill"]);
  expect(() => readZip(new TextEncoder().encode("not a zip"))).toThrow(
    "not a .zip",
  );
});

test("a GitHub folder link imports only that folder", async () => {
  expect(
    gitHubSource("https://github.com/acme/skills/tree/main/skills/pdf"),
  ).toEqual({ owner: "acme", repo: "skills", ref: "main", path: "skills/pdf" });
  expect(gitHubSource("https://github.com/acme/skills")).toEqual({
    owner: "acme",
    repo: "skills",
    ref: "HEAD",
    path: "",
  });
  expect(() => gitHubSource("https://example.com/acme/skills")).toThrow(
    "github.com",
  );
  expect(() => gitHubSource("http://github.com/acme/skills")).toThrow();
  const tarball = await new Bun.Archive(
    {
      "skills-abc123/README.md": "Not a skill",
      "skills-abc123/skills/pdf/SKILL.md": skillMd("pdf", "PDFs."),
      "skills-abc123/skills/pdf/scripts/extract.py": "print(1)",
      "skills-abc123/skills/other/SKILL.md": skillMd("other", "Other."),
    },
    { compress: "gzip" },
  ).bytes();
  const asked: string[] = [];
  const fakeFetch = (async (url: string) => {
    asked.push(url);
    return new Response(tarball);
  }) as unknown as typeof fetch;
  const files = await gitHubFiles(
    gitHubSource("https://github.com/acme/skills/tree/main/skills/pdf"),
    fakeFetch,
  );
  expect(asked).toEqual([
    "https://codeload.github.com/acme/skills/tar.gz/main",
  ]);
  expect([...files.keys()].sort()).toEqual(["SKILL.md", "scripts/extract.py"]);
  expect([...skillsIn(files).keys()]).toEqual(["pdf"]);
});

test("skills are saved in the workspace, offered to the bot and read with read_skill", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-skills-"));
  const prompts: string[] = [];
  const tools: string[][] = [];
  const messages: string[] = [];
  const gateway = await Gateway.open({
    directory,
    botId: "default",
    deferResume: true,
    ...chatModel({
      systemPrompt: (text) => prompts.push(text),
      offeredTools: (names) => tools.push(names),
      userMessages: (sent) => messages.push(JSON.stringify(sent.at(-1))),
    }),
  });
  const server = await startServer(gateway, { port: 0 });
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${server.url}/api/skills${path}`, {
      method,
      headers: {
        "x-raphie-client": "web",
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const turn = async (text: string) => {
    const sent = await gateway.chats.send({
      source: "web",
      actor: "owner",
      eventId: crypto.randomUUID(),
      text,
    });
    for (
      let n = 0;
      n < 300 &&
      (await gateway.chats.state()).turns.find((t) => t.id === sent.id)
        ?.status === "pending";
      n++
    )
      await delay(10);
  };
  try {
    expect(await (await call("GET", "")).json()).toEqual({ items: [] });
    const report = {
      files: [
        {
          path: "SKILL.md",
          text: skillMd(
            "weekly-report",
            "Write the Friday status report.",
            "Fill assets/template.md.\n",
          ),
        },
        { path: "assets/template.md", text: "# Week\n" },
      ],
    };
    // The name in the file must match the folder it is saved as.
    expect((await call("POST", "/other-name", report)).status).toBe(400);
    expect(
      (
        await call("POST", "/weekly-report", {
          files: [{ path: "../escape.md", text: "x" }, ...report.files],
        })
      ).status,
    ).toBe(400);
    const created = await call("POST", "/weekly-report", report);
    expect(created.status).toBe(201);
    expect((await call("POST", "/weekly-report", report)).status).toBe(409);
    expect(await created.json()).toMatchObject({
      name: "weekly-report",
      enabled: true,
      files: ["SKILL.md", "assets/template.md"],
      problem: null,
    });

    // The skill is a folder in the bot's workspace.
    const listing = await gateway.workspace.list(
      "/workspace/skills/weekly-report",
    );
    expect(listing.items.map((item) => item.name).sort()).toEqual([
      "SKILL.md",
      "assets",
    ]);

    await turn("Write this week's report.");
    expect(prompts.at(-1)).toContain("<name>weekly-report</name>");
    expect(prompts.at(-1)).toContain("Write the Friday status report.");
    expect(tools.at(-1)).toContain("read_skill");
    expect(await gateway.skills.read("weekly-report")).toContain(
      "Fill assets/template.md.",
    );
    expect(
      await gateway.skills.read("weekly-report", "assets/template.md"),
    ).toBe("# Week\n");

    // Typing /name loads the skill into that message, as Telegram spells it too.
    await turn("/weekly-report for the design team");
    expect(messages.at(-1)).toContain(
      'The owner invoked your skill \\"weekly-report\\"',
    );
    expect(messages.at(-1)).toContain("Fill assets/template.md.");
    expect(messages.at(-1)).toContain("for the design team");
    await turn("/weekly_report@raphie_bot again");
    expect(messages.at(-1)).toContain("Fill assets/template.md.");
    // Paths and unknown names stay plain text.
    await turn("/tmp is full");
    expect(messages.at(-1)).not.toContain("invoked your skill");

    // Turned off, it stays in the workspace but is not offered or read.
    expect(
      (await call("PUT", "/weekly-report/enabled", { enabled: false })).status,
    ).toBe(200);
    await turn("Anything else?");
    expect(prompts.at(-1)).not.toContain("weekly-report");
    let refused = "";
    try {
      await gateway.skills.read("weekly-report");
    } catch (error) {
      refused = String(error);
    }
    expect(refused).toContain("turned off");
    // The owner can still invoke it by name.
    await turn("/weekly-report now");
    expect(messages.at(-1)).toContain("invoked your skill");

    // A skill the bot writes itself is found on its next turn.
    await gateway.workspace.replaceTree("/workspace/skills/bot-notes", [
      {
        path: "/workspace/skills/bot-notes/SKILL.md",
        bytes: new TextEncoder().encode(skillMd("bot-notes", "Keep notes.")),
      },
    ]);
    await turn("Take a note.");
    expect(prompts.at(-1)).toContain("<name>bot-notes</name>");

    // A broken skill is listed with its problem, and not offered.
    await gateway.workspace.replaceTree("/workspace/skills/broken", [
      {
        path: "/workspace/skills/broken/SKILL.md",
        bytes: new TextEncoder().encode("no frontmatter"),
      },
    ]);
    const items = (await (await call("GET", "")).json()) as {
      items: { name: string; problem: string | null; enabled: boolean }[];
    };
    expect(items.items.map((i) => [i.name, i.enabled, !!i.problem])).toEqual([
      ["bot-notes", true, false],
      ["broken", true, true],
      ["weekly-report", false, false],
    ]);

    // A .zip import installs its skills; an existing one needs `replace`.
    const form = (replace: boolean) => {
      const data = new FormData();
      data.set(
        "file",
        new File(
          [
            zip({
              "pdf-tables/SKILL.md": skillMd("pdf-tables", "Pull tables."),
              "pdf-tables/scripts/extract.py": "print('tables')\n",
            }),
          ],
          "pdf-tables.zip",
        ),
      );
      data.set("replace", String(replace));
      return data;
    };
    const upload = (replace: boolean) =>
      fetch(`${server.url}/api/skills/import`, {
        method: "POST",
        headers: { "x-raphie-client": "web" },
        body: form(replace),
      });
    const imported = await upload(false);
    expect(imported.status).toBe(201);
    expect(await imported.json()).toEqual({ installed: ["pdf-tables"] });
    expect((await upload(false)).status).toBe(409);
    expect((await upload(true)).status).toBe(201);
    expect(
      await gateway.skills.read("pdf-tables", "scripts/extract.py"),
    ).toContain("tables");

    // The editor saves the text files it shows; deleting removes the folder.
    expect(
      (
        await call("PUT", "/weekly-report", {
          files: [
            {
              path: "SKILL.md",
              text: skillMd("weekly-report", "Write the Friday report."),
            },
          ],
        })
      ).status,
    ).toBe(200);
    expect((await call("DELETE", "/weekly-report")).status).toBe(204);
    expect((await call("GET", "/weekly-report")).status).toBe(404);
  } finally {
    await server.close();
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
