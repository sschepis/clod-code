/**
 * Native dynamic import that bypasses TypeScript's CommonJS transform.
 *
 * TypeScript with `module: "commonjs"` rewrites `await import('pkg')` into
 * `Promise.resolve().then(() => require('pkg'))`, which fails for ESM-only
 * packages with `ERR_REQUIRE_ESM` on Node 18.
 *
 * Wrapping `import()` in `new Function()` prevents TypeScript from touching
 * it — the string literal is opaque to the compiler. At runtime, Node.js
 * uses its native dynamic ESM import which works fine from CJS code.
 */
const dynamicImport: <T = any>(specifier: string) => Promise<T> =
  new Function('specifier', 'return import(specifier)') as any;

export { dynamicImport };
