"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Zap } from "lucide-react";

interface CreditStatus {
  credits: {
    allowanceRemaining: number;
    purchasedRemaining: number;
    totalRemaining: number;
    allowanceCredits: number;
    purchasedCredits: number;
  };
}

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? sessionStorage.getItem("auth_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchCreditStatus(): Promise<CreditStatus> {
  const res = await fetch("/api/billing/status", { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

interface CreditMeterProps {
  collapsed?: boolean;
}

export function CreditMeter({ collapsed = false }: CreditMeterProps) {
  const { data } = useQuery<CreditStatus>({
    queryKey: ["/api/billing/status"],
    queryFn: fetchCreditStatus,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const allowance = data?.credits?.allowanceRemaining ?? 0;
  const purchased = data?.credits?.purchasedRemaining ?? 0;
  const total = allowance + purchased;
  const maxTotal = (data?.credits?.allowanceCredits ?? 0) + (data?.credits?.purchasedCredits ?? 0);

  const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  const isRed = total === 0;
  const isAmber = !isRed && pct < 20;

  const barColor = isRed
    ? "bg-red-500"
    : isAmber
    ? "bg-amber-400"
    : "bg-primary";

  const textColor = isRed
    ? "text-red-500"
    : isAmber
    ? "text-amber-500"
    : "text-foreground";

  if (collapsed) {
    return (
      <Link
        href="/settings/billing"
        className="flex items-center justify-center"
        data-testid="credit-meter-collapsed"
        title={`${total} credits remaining`}
      >
        <Zap
          className={`w-4 h-4 ${isRed ? "text-red-500" : isAmber ? "text-amber-400" : "text-yellow-400"}`}
        />
      </Link>
    );
  }

  return (
    <Link
      href="/settings/billing"
      className="block px-2 py-1.5 rounded-md hover-elevate"
      data-testid="credit-meter"
    >
      <div className="flex items-center justify-between gap-1 mb-1 flex-wrap">
        <div className="flex items-center gap-1">
          <Zap className={`w-3 h-3 ${isRed ? "text-red-500" : isAmber ? "text-amber-400" : "text-yellow-400"}`} />
          <span className={`text-xs font-medium tabular-nums ${textColor}`}>
            {total.toLocaleString()} credits
          </span>
        </div>
        {isRed && (
          <span className="text-xs text-red-500 font-medium">No credits</span>
        )}
      </div>

      {maxTotal > 0 && (
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}

      {!collapsed && data && (
        <div className="flex gap-2 mt-1">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {allowance.toLocaleString()} allowance
          </span>
          {purchased > 0 && (
            <>
              <span className="text-[10px] text-muted-foreground">+</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {purchased.toLocaleString()} purchased
              </span>
            </>
          )}
        </div>
      )}
    </Link>
  );
}
