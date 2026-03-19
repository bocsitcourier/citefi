export function validateExternalUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL format");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }
  const hostname = parsed.hostname.toLowerCase();
  const blocked = [
    "localhost", "127.0.0.1", "0.0.0.0", "[::1]", "169.254.169.254",
    "metadata.google.internal", "metadata.google.com",
  ];
  if (blocked.includes(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal") ||
      /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) {
    throw new Error("Access to internal/private addresses is not allowed");
  }
}
