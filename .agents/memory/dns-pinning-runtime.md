---
name: DNS pinning and Node lookup contracts
description: Preserve SSRF protection while supporting Node's all-address lookup contract.
---

Custom DNS-pinned HTTP clients must honor the lookup callback's `options.all` contract, returning an address array when requested rather than always returning a scalar address.

**Why:** Node's connection selection requested all addresses, making previously scalar-only pinned requests fail before TLS even for valid public websites. A development preview hostname separately resolved to a private address and was correctly blocked; these were different failures.

**How to apply:** Verify a known public URL through the actual pinned-fetch function and test private-address rejection separately. Do not loosen SSRF checks or allowlist a development hostname to compensate for a transport-contract bug.