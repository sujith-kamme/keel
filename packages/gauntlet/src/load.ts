import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { Scenario } from "./scenario";

export function parseScenario(obj: unknown): Scenario {
  return Scenario.parse(obj);
}

const BUILTIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "scenarios");

function yamlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? yamlFiles(join(dir, e.name)) : e.name.endsWith(".yaml") ? [join(dir, e.name)] : []))
    .sort();
}

/** Loads every *.yaml under dir. Any invalid file or duplicate id throws, naming the file. */
export function loadBuiltin(dir: string = BUILTIN_DIR): Scenario[] {
  const seen = new Map<string, string>();
  return yamlFiles(dir).map((file) => {
    let scenario: Scenario;
    try {
      scenario = parseScenario(parse(readFileSync(file, "utf8")));
    } catch (e) {
      throw new Error(`Invalid scenario ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const first = seen.get(scenario.id);
    if (first) throw new Error(`Duplicate scenario id ${scenario.id} in ${file} (first in ${first})`);
    seen.set(scenario.id, file);
    return scenario;
  });
}
