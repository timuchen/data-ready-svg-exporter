import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const uiSource = path.join(rootDir, "plugin", "ui.html");
const uiOutput = path.join(distDir, "ui.html");

await mkdir(distDir, { recursive: true });

const uiHtml = await readFile(uiSource, "utf8");

await esbuild.build({
  entryPoints: [path.join(rootDir, "plugin", "code.ts")],
  bundle: true,
  format: "iife",
  target: "es2018",
  outfile: path.join(distDir, "code.js"),
  banner: {
    js: `
var __global = typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : this);
function __utf8Encode(input) {
  var encoded = unescape(encodeURIComponent(input));
  var bytes = new Uint8Array(encoded.length);
  for (var i = 0; i < encoded.length; i++) bytes[i] = encoded.charCodeAt(i);
  return bytes;
}
function __utf8Decode(input) {
  var bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  var encoded = "";
  for (var i = 0; i < bytes.length; i++) encoded += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(encoded));
}
if (typeof __global.TextEncoder === "undefined") {
  __global.TextEncoder = function TextEncoder() {};
  __global.TextEncoder.prototype.encode = function(input) {
    return __utf8Encode(String(input));
  };
  __global.TextEncoder.prototype.encodeInto = function(input, view) {
    var bytes = __utf8Encode(String(input));
    var length = Math.min(bytes.length, view.length);
    for (var i = 0; i < length; i++) view[i] = bytes[i];
    return { read: String(input).length, written: length };
  };
}
if (typeof __global.TextDecoder === "undefined") {
  __global.TextDecoder = function TextDecoder() {};
  __global.TextDecoder.prototype.decode = function(input) {
    return __utf8Decode(input);
  };
}
`,
  },
  define: {
    __html__: JSON.stringify(uiHtml),
  },
});

await writeFile(uiOutput, uiHtml);
