import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

type NodeAbortError = Error & {
  code?: string;
  status?: number;
  statusCode?: number;
  statusText?: string;
};

const NODE_ABORT_CODES = new Set(["ECONNRESET", "ECONNABORTED", "EPIPE"]);

function isNodeAbortError(
  err: unknown,
  req: IncomingMessage,
  res: ServerResponse
): err is NodeAbortError {
  if (err == null || typeof err !== "object") {
    return false;
  }
  const candidate = err as Partial<NodeAbortError>;
  if (candidate.code && NODE_ABORT_CODES.has(candidate.code)) {
    return true;
  }
  if (candidate.message === "aborted" || candidate.name === "AbortError") {
    return true;
  }
  return Boolean(req.destroyed || res.destroyed);
}

function stampClientAbortMetadata(err: NodeAbortError): void {
  try {
    err.status ??= 499;
    err.statusCode ??= 499;
    err.statusText ??= "Client Closed Request";
  } catch {
    // Ignore frozen/non-writable error objects.
  }
}

/**
 * Prevent dev-server console noise when Vite HMR / page reloads abort in-flight
 * HTTP requests (Node emits `Error: aborted` with `ECONNRESET` from `abortIncoming`).
 * Stamping HTTP 499 lets `@tanstack/start-server-core` recognize it as a handled
 * client close instead of logging an unexpected 500 stack trace.
 */
function silenceClientAbortPlugin(): Plugin {
  return {
    name: "hrm:silence-client-abort",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const originalEmit = req.emit.bind(req) as IncomingMessage["emit"];
        req.emit = ((event: string | symbol, ...args: unknown[]) => {
          if (event === "error" && isNodeAbortError(args[0], req, res)) {
            stampClientAbortMetadata(args[0]);
          }
          return originalEmit(event, ...args);
        }) as IncomingMessage["emit"];

        req.on("error", (err: unknown) => {
          if (isNodeAbortError(err, req, res)) {
            stampClientAbortMetadata(err);
            return;
          }
          if (req.listenerCount("error") <= 1) {
            throw err;
          }
        });

        res.on("error", (err: unknown) => {
          if (isNodeAbortError(err, req, res)) {
            stampClientAbortMetadata(err);
            return;
          }
          if (res.listenerCount("error") <= 1) {
            throw err;
          }
        });

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [silenceClientAbortPlugin()],
  nitro: {
    preset: process.env["VERCEL"] ? "vercel" : "node-server",
    hooks: {
      compiled: async (nitro: { options: { output: { serverDir?: string } } }) => {
        const outputDir = nitro.options.output.serverDir || path.resolve(".vercel/output/functions/__server.func");
        if (!fs.existsSync(outputDir)) return;
        
        function patchFileContent(content: string): string {
          // 1. Hoist __defProp definitions
          content = content.replace(
            /var (__defProp(?:\$[0-9]+)?)\s*=\s*Object\.defineProperty\s*;?/g,
            "function $1(target, name, desc) { return Object.defineProperty(target, name, desc); }"
          );

          // 2. Hoist __name definitions
          content = content.replace(
            /var (__name(?:\$[0-9]+)?)\s*=\s*\((target,\s*value)\)\s*=>\s*[^;]+;/g,
            "function $1(target, value) { return Object.defineProperty(target, 'name', { value, configurable: true }); }"
          );

          // 3. Hoist __exportAll definitions and use Object.defineProperty directly
          content = content.replace(
            /var __exportAll\s*=\s*\(all,\s*no_symbols\)\s*=>\s*\{[\s\S]*?\n\};/g,
            `function __exportAll(all, no_symbols) {
	let target = {};
	for (var name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true });
	if (!no_symbols) Object.defineProperty(target, Symbol.toStringTag, { value: "Module" });
	return target;
};`
          );

          // 4. Hoist __commonJSMin correctly
          content = content.replace(
            /var __commonJSMin\s*=\s*\(cb,\s*mod\)\s*=>\s*\(\)\s*=>\s*\(([\s\S]*?)\);/g,
            "function __commonJSMin(cb, mod) { return () => ($1); }"
          );

          // 5. Hoist __toESM correctly
          content = content.replace(
            /var __toESM\s*=\s*\(mod,\s*isNodeMode,\s*target\)\s*=>\s*\(([\s\S]*?)\);/g,
            "function __toESM(mod, isNodeMode, target) { return ($1); }"
          );

          // 6. Hoist __copyProps correctly
          content = content.replace(
            /var __copyProps\s*=\s*\(to,\s*from,\s*except,\s*desc\)\s*=>\s*\{([\s\S]*?)\n\};/g,
            "function __copyProps(to, from, except, desc) {$1\n};"
          );

          return content;
        }

        function patchDir(dir: string) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              patchDir(fullPath);
            } else if (entry.name.endsWith(".mjs") || entry.name.endsWith(".js")) {
              const original = fs.readFileSync(fullPath, "utf8");
              const patched = patchFileContent(original);
              if (patched !== original) {
                fs.writeFileSync(fullPath, patched, "utf8");
              }
            }
          }
        }
        
        patchDir(outputDir);

        if (process.env["VERCEL"]) {
          const vercelDir = path.resolve(".vercel/output");
          if (fs.existsSync(vercelDir)) {
            const configJsonPath = path.join(vercelDir, "config.json");
            if (!fs.existsSync(configJsonPath)) {
              fs.writeFileSync(
                configJsonPath,
                JSON.stringify(
                  {
                    version: 3,
                    routes: [
                      { handle: "filesystem" },
                      { src: "/(.*)", dest: "/__server" },
                    ],
                  },
                  null,
                  2
                ),
                "utf8"
              );
            }

            const vcConfigPath = path.join(outputDir, ".vc-config.json");
            if (!fs.existsSync(vcConfigPath)) {
              fs.writeFileSync(
                vcConfigPath,
                JSON.stringify(
                  {
                    runtime: "nodejs22.x",
                    handler: "index.mjs",
                    launcherType: "Nodejs",
                  },
                  null,
                  2
                ),
                "utf8"
              );
            }
          }
        }
      },
    },
  } as Record<string, unknown>,
});
