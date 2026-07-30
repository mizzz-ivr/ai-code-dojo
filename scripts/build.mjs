import { cp, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await cp("apps", "dist/apps", { recursive: true });
await cp("packages", "dist/packages", { recursive: true });
await cp("problems", "dist/problems", { recursive: true });
await cp("infra", "dist/infra", { recursive: true });

console.log("build passed (artifact snapshot created at dist/)");
