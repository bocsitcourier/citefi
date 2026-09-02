import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";

function showErrorToast(message: string) {
  if (typeof window === "undefined") return;
  import("@/hooks/use-toast").then(({ toast }) => {
    toast({
      title: "Something went wrong",
      description: message,
      variant: "destructive",
    });
  }).catch(() => {});
}

function reportClientError(type: string, error: Error) {
  if (typeof window === "undefined") return;
  csrfFetch("/api/client-errors", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type,
      message: error.message || String(error),
      stack: error.stack,
      url: window.location.href,
    }),
    keepalive: true,
  }).catch(() => {});
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Skip 401/403 — auth-context handles those (redirect to login)
      const status = (error as any)?.status;
      if (status === 401 || status === 403) return;
      // Skip if query opted out of the global toast
      if ((query.meta as any)?.suppressGlobalError) return;
      reportClientError("QUERY_ERROR", error as Error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const status = (error as any)?.status;
      if (status === 401 || status === 403 || status === 402) return;
      if ((mutation.meta as any)?.suppressGlobalError) return;
      const message = (error as Error)?.message || "Request failed";
      showErrorToast(message);
      reportClientError("MUTATION_ERROR", error as Error);
    },
  }),
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => {
        const url = queryKey[0] as string;
        const response = await fetch(url, {
          credentials: "include",
        });
        if (!response.ok) {
          const err = new Error(`HTTP error! status: ${response.status}`) as any;
          err.status = response.status;
          throw err;
        }
        return response.json();
      },
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export async function csrfFetch(url: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  const body = options?.body;
  const browserSelectsContentType =
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) ||
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer);
  if (body != null && !browserSelectsContentType && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const method = (options?.method || "GET").toUpperCase();
  if (typeof document !== "undefined" && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("csrf_token="))
      ?.slice("csrf_token=".length);
    if (csrf) headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  }

  return fetch(url, {
    ...options,
    credentials: "include",
    headers,
  });
}

export async function apiRequest(url: string, options?: RequestInit) {
  const response = await csrfFetch(url, options);
  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    let errorData: any = null;
    try {
      errorData = await response.json();
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch {
      errorMessage = `Server error (${response.status}): ${response.statusText || "Unknown error"}`;
    }
    if (response.status === 402 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("citefi:paywall", { detail: errorData ?? { message: errorMessage } }));
    }
    const err = new Error(errorMessage) as any;
    err.status = response.status;
    err.data = errorData;
    throw err;
  }

  return response.json();
}
