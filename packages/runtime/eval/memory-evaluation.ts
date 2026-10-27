import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeMemory } from "../src/domains/memory/infrastructure/runtime-memory.ts";

// Synthetic, deterministic fixtures. The expected IDs are authored independently of retrieval.
const records = [
  ["tea", "The owner prefers jasmine tea in the morning."],
  ["bike", "The owner cycles to work on weekdays."],
  ["allergy", "The owner avoids peanuts because of an allergy."],
  ["editor", "The owner uses Neovim for programming."],
  ["language", "The owner speaks Amharic at home."],
  ["project", "The owner maintains the Cedar garden project."],
  ["meeting", "The owner schedules meetings after lunch."],
  ["music", "The owner enjoys jazz while working."],
  ["pet", "The owner has a dog named Miso."],
  ["food", "The owner likes spicy noodles."],
  ["travel", "The owner visits Kyoto every spring."],
  ["device", "The owner uses a Linux laptop."],
] as const;
const queries = [
  { category: "lexical", query: "jasmine tea", id: "tea" },
  { category: "lexical", query: "Cedar garden", id: "project" },
  { category: "lexical", query: "Neovim programming", id: "editor" },
  { category: "paraphrase", query: "cycling commute", id: "bike" },
  { category: "paraphrase", query: "scheduled meeting", id: "meeting" },
  { category: "paraphrase", query: "peanut allergies", id: "allergy" },
  {
    category: "paraphrase",
    query: "What beverage does the owner like?",
    id: "tea",
  },
  {
    category: "paraphrase",
    query: "Which language is spoken at home?",
    id: "language",
  },
  {
    category: "paraphrase",
    query: "What is the name of the owner's canine?",
    id: "pet",
  },
] as const;

const directory = await mkdtemp(join(tmpdir(), "raphie-memory-eval-"));
const secrets = { sealMemoryKey: () => null, openMemoryKey: () => null };
const path = join(directory, "memory.sqlite");
let memory = new RuntimeMemory(path, secrets);
const other = new RuntimeMemory(path, secrets, undefined, "evaluation-other");
try {
  for (const [id, content] of records)
    await memory.retain({
      id,
      content,
      kind: "fact",
      source: `session:eval/turn:${id}`,
      eventTime: 1,
    });
  memory.close();
  memory = new RuntimeMemory(path, secrets);
  const retained = (await memory.browse()).total;
  console.log(`retention after restart: ${retained}/${records.length}`);
  for (const category of ["lexical", "paraphrase"] as const) {
    const cases = queries.filter((item) => item.category === category);
    let hits = 0;
    for (const item of cases) {
      const ids = (await memory.recall(item.query)).evidence.map(
        (entry) => entry.id,
      );
      const hit = ids.includes(item.id);
      if (hit) hits++;
      console.log(
        `${category}: ${hit ? "hit" : "MISS"} ${item.id} (${item.query})`,
      );
    }
    console.log(`${category} recall@8: ${hits}/${cases.length}`);
  }
  await memory.revise("tea", "The owner prefers coffee in the morning.");
  await memory.retain({
    id: "tea",
    content: records[0][1],
    kind: "fact",
    source: "session:eval/turn:tea",
    eventTime: 1,
  });
  const corrected = (await memory.recall("coffee")).evidence.some(
    (e) => e.id === "tea" && e.revision === 2,
  );
  const old = (await memory.recall("jasmine")).evidence.some(
    (e) => e.id === "tea",
  );
  await memory.forget("tea");
  await memory.retain({
    id: "tea",
    content: records[0][1],
    kind: "fact",
    source: "session:eval/turn:tea",
    eventTime: 1,
  });
  const forgotten = !(await memory.recall("coffee jasmine")).evidence.some(
    (e) => e.id === "tea",
  );
  await other.retain({
    id: "private",
    content: "The owner prefers jasmine tea.",
    kind: "fact",
    source: "session:other/turn:1",
    eventTime: 1,
  });
  const isolated =
    !(await memory.recall("jasmine")).evidence.some(
      (e) => e.id === "private",
    ) &&
    (await other.recall("jasmine")).evidence.map((e) => e.id).join() ===
      "private";
  console.log(`correction and replay: ${corrected && !old ? "PASS" : "FAIL"}`);
  console.log(`forget and replay: ${forgotten ? "PASS" : "FAIL"}`);
  console.log(`cross-bot isolation: ${isolated ? "PASS" : "FAIL"}`);
  if (
    retained !== records.length ||
    !corrected ||
    old ||
    !forgotten ||
    !isolated
  )
    process.exitCode = 1;
} finally {
  memory.close();
  other.close();
  await rm(directory, { recursive: true, force: true });
}
