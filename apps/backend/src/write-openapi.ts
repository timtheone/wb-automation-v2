import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createApp } from "./app.js";
import { backendOpenApiDocument } from "./openapi/document.js";

const outputArg = Bun.argv[2] ?? "openapi.json";
const outputPath = resolve(process.cwd(), outputArg);

const { app } = createApp();
const spec = app.getOpenAPI31Document(backendOpenApiDocument);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");

console.log(`OpenAPI spec written to ${outputPath}`);
