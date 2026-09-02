import path from 'path';

/**
 * Resolves a child path and rejects absolute paths and directory traversal.
 * Keep all receiver filesystem writes behind this check because request
 * payloads are untrusted, even when their routes are HMAC authenticated.
 */
export function resolvePathWithin(rootDirectory: string, ...pathSegments: string[]): string {
  const root = path.resolve(rootDirectory);
  const resolved = path.resolve(root, ...pathSegments);
  const relative = path.relative(root, resolved);

  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Refusing to access a path outside its configured storage directory');
  }

  return resolved;
}

/**
 * Produces a single, non-empty filename component for generated content.
 */
export function createSafeSlug(value: string, maxLength = 80): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength);

  if (!slug) {
    throw new Error('A title or slug containing at least one letter or number is required');
  }

  return slug;
}