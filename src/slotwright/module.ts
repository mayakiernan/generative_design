/**
 * build.mjs as a module the browser can load from a blob URL: imports of the SDK become reads of the copy the Web
 * Worker already holds (globalThis.__slotlayer), on the same line, so line numbers in errors stay right.
 */
export function asModule(source: string): string {
  return source
    .replace(/^\s*import\s*\{([^}]*)\}\s*from\s*['"][^'"]*['"]\s*;?/gm, (_, names: string) => `const {${names.replace(/\bas\b/g, ':')}} = globalThis.__slotlayer;`)
    .replace(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s*['"][^'"]*['"]\s*;?/gm, 'const $1 = globalThis.__slotlayer;');
}
