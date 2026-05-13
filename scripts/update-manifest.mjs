import { writeFile } from "node:fs/promises";

const args = new Map();

for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const value = process.argv[index + 1];

  if (key?.startsWith("--")) {
    args.set(key.slice(2), value ?? "");
    index += 1;
  }
}

const version = args.get("version")?.trim();
const url = args.get("url")?.trim();
const signature = args.get("signature")?.trim();
const notes = args.get("notes")?.trim() || "Hardy MODS Update";
const out = args.get("out")?.trim() || "latest.json";

if (!version || !url || !signature) {
  console.error(
    [
      "Usage:",
      '  npm.cmd run release:manifest -- --version 0.1.50 --url "https://github.com/.../Hardy%20MODS_0.1.50_x64-setup.exe" --signature "..."',
      "",
      "Optional:",
      '  --notes "Release notes"',
      "  --out latest.json",
    ].join("\n"),
  );
  process.exit(1);
}

try {
  const parsedUrl = new URL(url);

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("URL must be http or https");
  }
} catch (error) {
  console.error(`Invalid --url: ${error.message}`);
  process.exit(1);
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url,
    },
  },
};

await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Wrote ${out} for version ${version}`);
