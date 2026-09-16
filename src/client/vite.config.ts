// Build of the webview client into dist/client.
// Two entrypoints (see devvit.json → post.entrypoints):
//   splash.html → "default" - the first screen shown inline in the feed (height "regular")
//   index.html  → "game"    - the board, opened via requestExpandedMode() (fullscreen/modal)
import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";

// Inline every entry's stylesheet into its HTML. The splash is the feed's first paint and a
// render-blocking <link> round-trip there is pure latency; keeping CSS in real .css files also
// keeps the palette swappable in one place (tokens.css) instead of a wall of inline <style>.
function inlineEntryCss(): Plugin {
  return {
    name: "deducto-inline-entry-css",
    enforce: "post",
    generateBundle(_options, bundle) {
      const css = new Map<string, string>();
      for (const [name, out] of Object.entries(bundle))
        if (out.type === "asset" && name.endsWith(".css")) css.set(name, String(out.source));

      const used = new Set<string>();
      for (const [name, out] of Object.entries(bundle)) {
        if (out.type !== "asset" || !name.endsWith(".html")) continue;
        out.source = String(out.source).replace(
          /<link[^>]+rel="stylesheet"[^>]*>/g,
          (tag) => {
            const href = /href="\/?([^"]+\.css)"/.exec(tag)?.[1];
            const code = href ? css.get(href) : undefined;
            if (!href || code === undefined) return tag;
            used.add(href);
            return `<style>${code}</style>`;
          },
        );
      }
      for (const name of used) {
        delete bundle[name];
        delete bundle[name + ".map"];
      }
    },
  };
}

export default defineConfig({
  plugins: [inlineEntryCss()],
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        splash: resolve(__dirname, "splash.html"),
        index: resolve(__dirname, "index.html"),
      },
    },
  },
});
