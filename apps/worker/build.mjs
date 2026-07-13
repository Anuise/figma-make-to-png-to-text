import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const outputDirectory = new URL("./dist/", import.meta.url);

await rm(outputDirectory, { recursive: true, force: true });
await build({
  bundle: true,
  entryPoints: [fileURLToPath(new URL("./src/main.ts", import.meta.url))],
  external: ["pg"],
  format: "esm",
  outfile: fileURLToPath(new URL("./dist/src/main.mjs", import.meta.url)),
  platform: "node",
});
await cp(
  new URL("../../packages/database/migrations/", import.meta.url),
  new URL("./dist/migrations/", import.meta.url),
  { recursive: true },
);
