/**
 * The resolver that lets the checks in this folder import the app's own modules.
 *
 * `node scripts/s3-check.mts` runs TypeScript directly by stripping types, but Node
 * resolves every specifier literally: no `tsconfig` `paths`, no extension inference, no
 * directory index. The app writes `@/db/client`, `./schema` and `./archive`, so without
 * this the check cannot import the storage layer it exists to verify — and a check that
 * re-implements the query instead of calling the module proves nothing about the module.
 *
 * Two rules, both mirroring what the bundler already does:
 *
 *   `@/x`            → `<repo root>/x`, then `.ts`, `.tsx`, `.mts`, or `x/index.ts`
 *   `./x`, `../x`    → the same candidates, relative to the importing file
 *
 * Bare specifiers (`drizzle-orm`, `pg`, `@aws-sdk/*`) are left to Node, so a dependency
 * is never resolved by a rule of ours. Everything else falls through untouched, which is
 * why this can be 30 lines rather than a build system.
 *
 * Used as `node --import ./scripts/ts-paths.mjs …`, never by the app itself: Next has its
 * own resolver and this file is not part of it.
 */
import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The first candidate that is a file: the path as written, then the TS variants. */
function firstFile(base) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = null;

    if (specifier.startsWith("@/")) {
      target = path.join(root, specifier.slice(2));
    } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const parent = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : root;
      target = path.resolve(parent, specifier);
    }

    if (target) {
      const file = firstFile(target);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});
