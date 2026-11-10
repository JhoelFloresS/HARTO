import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/** Real path of `ref` when it stays inside `root`. Null when it escapes or is missing. */
export function insideProject(root: string, ref: string): string | null {
  if (ref.includes("\0")) return null;
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch {
    return null;
  }
  const abs = isAbsolute(ref) ? ref : resolve(rootReal, ref);
  let full: string;
  try {
    full = realpathSync(abs);
  } catch {
    return null;
  }
  const rel = relative(rootReal, full);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return full;
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
