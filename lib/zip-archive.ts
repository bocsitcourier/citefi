import * as archiverModule from "archiver";

export type ZipArchiveOptions = { zlib?: { level?: number } };
export type ZipArchive = import("archiver").Archiver;

/**
 * archiver v8 exposes archive constructors as named exports. Keep the
 * interop cast in one place so route bundles never depend on a CommonJS
 * default export that does not exist in the installed package.
 */
export const ZipArchive = (archiverModule as unknown as {
  ZipArchive: new (options?: ZipArchiveOptions) => ZipArchive;
}).ZipArchive;

export function createZipArchive(options?: ZipArchiveOptions): ZipArchive {
  return new ZipArchive(options);
}