// Generates postman/ from apps/api/openapi.yaml: npm run postman
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Converter from "openapi-to-postmanv2";
import { parse } from "yaml";

const BASE_URL = "https://keel-api-y0wq.onrender.com";
const source = readFileSync(new URL("../apps/api/openapi.yaml", import.meta.url), "utf8");
const spec = parse(source) as { paths: Record<string, Record<string, { security?: Record<string, unknown>[] }>> };

type Item = { item?: Item[]; request?: { method: string; url: { path?: string[] }; auth?: unknown } };

const collection = await new Promise<{ item: Item[]; auth?: unknown; variable?: { key: string; value: string }[] }>((resolve, reject) =>
  Converter.convert(
    { type: "string", data: source },
    { folderStrategy: "Tags", requestNameSource: "Fallback", parametersResolution: "Example" },
    (err, result) => {
      if (err || !result.result || !result.output[0]) return reject(err ?? new Error(result.reason));
      resolve(result.output[0].data as never);
    },
  ),
);

// Each request's bearer token is the variable named after its security scheme ({{operatorKey}}, …).
const schemeFor = new Map<string, string | null>();
for (const [path, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    const key = `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`;
    schemeFor.set(key, Object.keys(op.security?.[0] ?? {})[0] ?? null);
  }
}
const walk = (items: Item[]) => {
  for (const it of items) {
    if (it.item) walk(it.item);
    if (!it.request) continue;
    const key = `${it.request.method} /${(it.request.url.path ?? []).join("/")}`;
    if (!schemeFor.has(key)) throw new Error(`no operation for ${key}`);
    const scheme = schemeFor.get(key);
    it.request.auth = scheme
      ? { type: "bearer", bearer: [{ key: "token", value: `{{${scheme}}}`, type: "string" }] }
      : { type: "noauth" };
  }
};
walk(collection.item);
delete collection.auth;
collection.variable = (collection.variable ?? []).filter((v) => v.key !== "bearerToken");

const environment = {
  name: "Keel (Render)",
  values: [
    { key: "baseUrl", value: BASE_URL, type: "default", enabled: true },
    { key: "merchantKey", value: "", type: "secret", enabled: true },
    { key: "operatorKey", value: "", type: "secret", enabled: true },
    { key: "capabilityToken", value: "", type: "secret", enabled: true },
  ],
};

mkdirSync(new URL("../postman/", import.meta.url), { recursive: true });
writeFileSync(new URL("../postman/keel.postman_collection.json", import.meta.url), `${JSON.stringify(collection, null, 2)}\n`);
writeFileSync(new URL("../postman/keel.postman_environment.json", import.meta.url), `${JSON.stringify(environment, null, 2)}\n`);
console.log(`postman/: ${schemeFor.size} operations`);
