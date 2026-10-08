/** Verify durable COGS against native usage, not merely an "accounted" label. */
export function verifyLiveAccounting(tables, calls, teamId) {
  if (tables.provider_attempt_receipts.length !== calls.length ||
      tables.provider_usage_ledger.length !== calls.length) return false;
  return calls.every((call) => {
    const receipts = tables.provider_attempt_receipts.filter((r) =>
      r.provider === call.provider && r.model === call.model && r.team_id === teamId);
    if (receipts.length !== 1) return false;
    const receipt = receipts[0];
    const rows = tables.provider_usage_ledger.filter((r) =>
      r.source_event_id === receipt.source_event_id);
    if (rows.length !== 1 || receipt.status !== "accounted" ||
        !receipt.provider_request_id) return false;
    const row = rows[0];
    const usage = receipt.response_usage?.raw;
    const input = call.provider === "gemini" ? usage?.promptTokenCount : usage?.prompt_tokens;
    const output = call.provider === "gemini"
      ? usage?.candidatesTokenCount + (usage?.thoughtsTokenCount ?? 0)
      : usage?.completion_tokens;
    const total = call.provider === "gemini" ? usage?.totalTokenCount : usage?.total_tokens;
    if (![input, output, total].every((n) => Number.isSafeInteger(n) && n >= 0) ||
        total !== input + output || output > call.maxOutputTokens) return false;
    if (receipt.request_metadata?.maxOutputTokens !== call.maxOutputTokens ||
        (call.thinkingConfig && receipt.request_metadata?.thinkingLevel !== call.thinkingConfig.thinkingLevel)) return false;
    const rate = row.rate_snapshot;
    if (!rate || Number(rate.inputMicrousdPerMillion) !== call.inputUsdPerMillion * 1e6 ||
        Number(rate.outputMicrousdPerMillion) !== call.outputUsdPerMillion * 1e6 ||
        !row.rate_version_id || !row.provider_rate_id) return false;
    const cost = Number((BigInt(input) * BigInt(rate.inputMicrousdPerMillion) +
      BigInt(output) * BigInt(rate.outputMicrousdPerMillion) + 500000n) / 1000000n);
    return row.team_id === teamId && row.provider === call.provider && row.model === call.model &&
      row.provider_request_id === receipt.provider_request_id &&
      Number(row.input_units) === input && Number(row.output_units) === output &&
      Number(row.unit_count) === total && Number(row.cost_microusd) === cost &&
      receipt.response_usage.inputUnits === input && receipt.response_usage.outputUnits === output;
  });
}
