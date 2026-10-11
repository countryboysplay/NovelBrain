import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// src/hooks/memory.ts
import { appendFileSync, existsSync as existsSync2, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join as join2 } from "node:path";

// src/shared/bookpath.ts
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
function realish(p) {
  const rest = [];
  let cur = resolve(p);
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return resolve(p);
    rest.unshift(basename(cur));
    cur = parent;
  }
  return join(realpathSync.native(cur), ...rest);
}
function findBookRoot(start) {
  let cur = realish(start);
  for (; ; ) {
    if (existsSync(join(cur, "book.yaml"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

// src/hooks/memory.ts
try {
  if (process.env.NB_DISTILLER !== "1") {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const root = findBookRoot(typeof input.cwd === "string" ? input.cwd : process.cwd());
    const event = process.argv[2];
    const mem = process.env.NB_MEMORY_DIR ?? join2(homedir(), ".novelbrain", "memory");
    if (root && event === "start") {
      process.stdout.write("Novel Brain hooks loaded.\n");
      const brief = join2(root, ".novelbrain", "memory.md");
      if (existsSync2(brief)) process.stdout.write(readFileSync(brief, "utf8"));
    } else if (root && event === "enqueue" && typeof input.transcript_path === "string") {
      if (existsSync2(mem)) appendFileSync(join2(mem, ".queue"), `${JSON.stringify({ kind: "distill", transcript: input.transcript_path, book: root })}
`);
    }
  }
} catch {
}
process.exit(0);
