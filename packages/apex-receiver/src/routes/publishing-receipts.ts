import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config";
import { readNativeReceipt } from "../services/publishing-receipts";

const router = Router();
router.get("/:jobId", async (req, res) => {
  const timestamp = req.header("x-citefi-timestamp") ?? "";
  const signature = req.header("x-citefi-receipt-read-signature") ?? "";
  const expected = createHmac("sha256", getConfig().apiKey)
    .update(`publishing-receipt-read-v1.${timestamp}.${req.originalUrl}`).digest("hex");
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000 ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
    res.status(401).json({ error: "Read authorization required" }); return;
  }
  const attempt = req.query.dispatchAttempt;
  if (!/^[a-f0-9-]{36}$/i.test(req.params.jobId ?? "") || typeof attempt !== "string") {
    res.status(400).json({ error: "Invalid receipt reference" }); return;
  }
  try {
    const receipt = await readNativeReceipt(req.params.jobId!, attempt, getConfig());
    res.setHeader("Cache-Control", "no-store");
    if (!receipt) { res.status(404).json({ error: "No final receipt; outcome remains unknown" }); return; }
    res.setHeader("x-citefi-receipt-signature", receipt.signature);
    res.type("application/json").send(receipt.raw);
  } catch {
    res.status(503).json({ error: "Receipt read unavailable; outcome remains unknown" });
  }
});
export default router;
