---
name: Turbopack PostCSS ESM fix
description: Why require() in tailwind.config.ts causes a Turbopack worker timeout and how to fix it
---

## The rule
In a `"type": "module"` project, never use `require()` inside `tailwind.config.ts`. Use ESM `import` statements instead. Also explicitly point the postcss plugin to the tailwind config path.

**Why:** Turbopack spawns a child process to evaluate the PostCSS webpack loader. That child process runs in ESM context where `require` is not defined. When Tailwind's PostCSS plugin loads the config and hits `require("tailwindcss-animate")`, the call throws silently; the worker never sends its response; Turbopack waits for the deadline then panics with `"timeout while receiving message from process"`. This cascades to every page route that imports `globals.css`, causing 500 on all UI pages while API routes continue working fine.

**How to apply:**

`tailwind.config.ts` — use imports, not require():
```ts
import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";
// ...
plugins: [tailwindcssAnimate, typography],
```

`postcss.config.js` — add explicit config path to eliminate search overhead in the worker:
```js
export default {
  plugins: {
    tailwindcss: { config: './tailwind.config.ts' },
    autoprefixer: {},
  },
}
```

After fixing, clear stale Turbopack cache:
```bash
rm -rf .next/dev/cache/turbopack .next/cache .next/server .next/static
```

The symptom is always the same panic: `Failed to write app endpoint /page` → `[project]/app/globals.css [app-client] (css)` → `evaluate_webpack_loader` → `timeout while receiving message from process`.
