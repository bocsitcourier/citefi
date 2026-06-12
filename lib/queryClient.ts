import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => {
        const url = queryKey[0] as string;
        // Auth travels via the HttpOnly `auth_token` cookie, sent automatically
        // on same-origin requests. No need to read a token from JS.
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      },
      // Keep data in cache for 5 minutes before refetching
      staleTime: 5 * 60 * 1000,
      // Keep unused query results in memory for 10 minutes before GC
      gcTime: 10 * 60 * 1000,
      // Don't refetch just because the window regains focus — reduces burst requests
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export async function apiRequest(url: string, options?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> | undefined ?? {}),
  };

  // Auth travels via the HttpOnly `auth_token` cookie (same-origin), not JS.
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers,
  });

  if (!response.ok) {
    // Try to parse JSON error, fallback to generic message if HTML/text returned
    let errorMessage = `Request failed with status ${response.status}`;
    try {
      const error = await response.json();
      errorMessage = error.error || error.message || errorMessage;
    } catch {
      // Server returned HTML or non-JSON (404/500 error page)
      errorMessage = `Server error (${response.status}): ${response.statusText || 'Unknown error'}`;
    }
    throw new Error(errorMessage);
  }

  return response.json();
}
