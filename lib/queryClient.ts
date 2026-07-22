import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try { return sessionStorage.getItem("auth_token"); } catch { return null; }
}

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
  const token = getStoredToken();
  fetch("/api/client-errors", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
        const token = getStoredToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const response = await fetch(url, {
          credentials: "include",
          headers,
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

export async function apiRequest(url: string, options?: RequestInit) {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    ...(options?.headers as Record<string, string> | undefined ?? {}),
  };

  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers,
  });

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
