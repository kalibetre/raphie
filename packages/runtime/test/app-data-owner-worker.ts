import { ownAppData } from "../src/infrastructure/workspace/app-data-owner.ts";

await ownAppData(process.argv[2]);
console.log("owned");
await new Promise(() => {});
