import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Module resolver for the self-check scripts.
 *
 * The app source is written for a bundler: imports omit the `.ts` extension and
 * use the `@/` alias that `vite.config.ts` and `tsconfig` define. Node's ESM
 * resolver does neither, so running a check that reaches into `src/` needs this
 * bridge.
 *
 * It is a resolver only — Node strips the types itself. That keeps the checks
 * free of any build step or dependency, which is the whole reason they are
 * cheap enough to keep around.
 */

const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Extensions tried, in the order the bundler would try them. */
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

const firstExisting = (base) => {
  for (const suffix of CANDIDATES) {
    const candidate = base + suffix;
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
};

export async function resolve(specifier, context, next) {
  // `@/foo` -> `<src>/foo`, matching the alias in vite.config.ts.
  if (specifier.startsWith('@/')) {
    const hit = firstExisting(resolvePath(SRC, specifier.slice(2)));
    if (hit) return next(hit, context);
  }

  // Extensionless relative imports: `./curve` -> `./curve.ts`.
  if (specifier.startsWith('.') && !/\.[mc]?[jt]sx?$/.test(specifier)) {
    const parent = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : SRC;
    const hit = firstExisting(resolvePath(parent, specifier));
    if (hit) return next(hit, context);
  }

  return next(specifier, context);
}
