declare const __html__: string;

import { strToU8, zipSync } from "fflate";
import { buildExportResponse } from "./exportCore";
import type {
  ExportRequest,
  ExportResponse,
  SlotInput,
  SlotValueType,
  TextPayload,
  TextSegment,
} from "./contracts";

// Page: [p1], [p2], [p10] or [p2] Title (design-note.md + contract)
const PAGE_NAME_RE = /^\[(p\d+)\](?:\s.*)?$/i;
// Slot: [p2-r-str-1] or [p2-l-img-1] Logo — tag required, suffix optional
const SLOT_NAME_RE = /^(\[(p\d+)-(.+)-(str|i32|f64|bool|img)-(\d+)\])(?:\s.*)?$/i;

figma.showUI(__html__, {
  width: 960,
  height: 720,
  themeColors: true,
});

void postSelectionState();

figma.on("selectionchange", () => {
  void postSelectionState();
});

figma.ui.onmessage = async (message: { type: string; results?: unknown[] }) => {
  if (message.type === "close") {
    figma.closePlugin();
    return;
  }

  if (message.type === "create-zip") {
    const results = message.results as Array<{ rootName: string; result: ExportResponse }> | undefined;
    if (!results || results.length === 0) {
      figma.ui.postMessage({ type: "zip-error", message: "No export data." });
      return;
    }
    try {
      const files: Record<string, Uint8Array> = {};
      const seen = new Set<string>();
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const pageId = r.result?.sidecar?.page?.id;
        const pagePart = (pageId && String(pageId).replace(/[^\w-]/g, "_").replace(/^_+|_+$/g, "") || null) || "p" + i;
        const layerName = (r.rootName || "").replace(/^\[p\d+\]\s*/i, "").trim() || "frame";
        const layerPart = layerName
          .replace(/[^\w\s-]/g, "")
          .trim()
          .replace(/\s+/g, "_")
          .replace(/^_+|_+$/g, "") || "frame";
        let base = pagePart + "_" + layerPart;
        if (seen.has(base)) {
          let suffix = 1;
          while (seen.has(base + "_" + suffix)) suffix++;
          base = base + "_" + suffix;
        }
        seen.add(base);
        files[base + ".svg"] = strToU8(r.result.svg);
        files[base + ".json"] = strToU8(JSON.stringify(r.result.sidecar, null, 2));
      }
      const zipped = zipSync(files);
      figma.ui.postMessage({ type: "zip-ready", data: zipped });
    } catch (e) {
      figma.ui.postMessage({ type: "zip-error", message: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (message.type !== "run-export") {
    return;
  }

  try {
    const roots = getExportRoots();
    const assignments = computePageAssignments(roots);
    const results: { rootName: string; result: ExportResponse }[] = [];

    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      const { id: pageId, index: pageIndex } = assignments[i];
      const request = collectExportRequest(root, pageId, pageIndex);

      let fullSvgString: string;
      try {
        const out = await (root as ExportRootNode & { exportAsync(opts: { format: "SVG_STRING" }): Promise<string> }).exportAsync({ format: "SVG_STRING" });
        fullSvgString = typeof out === "string" ? out : decodeUtf8(out as Uint8Array);
      } catch (_) {
        const svgBytes = await root.exportAsync({ format: "SVG" });
        fullSvgString = decodeUtf8(svgBytes);
      }
      const innerSvg = extractSvgInnerContent(fullSvgString);
      request.staticSvg = innerSvg.length > 0 ? innerSvg : (fullSvgString.replace(/^[\s\S]*?<svg[\s\S]*?>|<\/svg>\s*$/gi, "").trim() || fullSvgString);

      const result: ExportResponse = buildExportResponse(request);
      results.push({ rootName: root.name, result });
    }

    figma.ui.postMessage({
      type: "export-result",
      payload: { results },
    });
  } catch (error) {
    figma.ui.postMessage({
      type: "export-error",
      payload: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
};

function decodeUtf8(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  try {
    const g =
      typeof globalThis !== "undefined"
        ? globalThis
        : typeof self !== "undefined"
          ? self
          : (typeof window !== "undefined" ? window : ({} as Window));
    const TD = (g as unknown as { TextDecoder?: new (label?: string) => { decode(buf: Uint8Array): string } })
      .TextDecoder;
    if (TD) return new TD("utf-8").decode(bytes);
  } catch (_) {
    /* ignore */
  }
  const CHUNK = 8192;
  let s = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    s += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return s;
}

function extractSvgInnerContent(svgString: string): string {
  if (!svgString || !svgString.trim()) return "";
  const open = svgString.indexOf("<svg");
  if (open === -1) return svgString;
  const close = svgString.indexOf(">", open);
  if (close === -1) return svgString;
  const start = close + 1;
  const endTag = svgString.lastIndexOf("</svg>");
  if (endTag === -1 || endTag <= start) return svgString;
  const inner = svgString.slice(start, endTag).trim();
  return inner || svgString;
}

/** Layout order: top-to-bottom, then left-to-right (by y, then x). */
function sortByLayoutOrder(roots: ExportRootNode[]): void {
  roots.sort((a, b) => {
    const yA = "y" in a ? a.y : 0;
    const yB = "y" in b ? b.y : 0;
    if (yA !== yB) return yA - yB;
    const xA = "x" in a ? a.x : 0;
    const xB = "x" in b ? b.x : 0;
    return xA - xB;
  });
}

/**
 * Assign page id and 0-based index per contract:
 * - All untagged: [p0], [p1], ... in layout order.
 * - Mixed: tagged keep their [pN]; untagged get next free number in layout order.
 */
function computePageAssignments(roots: ExportRootNode[]): { id: string; index: number }[] {
  const tagged = roots.map((r) => {
    const m = r.name.match(PAGE_NAME_RE);
    return m ? Number(m[1].slice(1)) : null;
  });
  const allUntagged = tagged.every((n) => n === null);

  if (allUntagged) {
    return roots.map((_, i) => ({ id: `[p${i}]`, index: i }));
  }

  const used = new Set<number>();
  let nextAvailable = 1;
  const out: { id: string; index: number }[] = [];

  for (let i = 0; i < roots.length; i++) {
    const num = tagged[i];
    if (num !== null) {
      used.add(num);
      out.push({ id: `[p${num}]`, index: num - 1 });
    } else {
      while (used.has(nextAvailable)) {
        nextAvailable++;
      }
      used.add(nextAvailable);
      out.push({ id: `[p${nextAvailable}]`, index: nextAvailable - 1 });
      nextAvailable++;
    }
  }
  return out;
}

function getExportRoots(): ExportRootNode[] {
  const selection = figma.currentPage.selection;
  const roots = selection.filter(
    (n): n is ExportRootNode => Boolean(n && isExportRoot(n)),
  );

  if (roots.length === 0) {
    throw new Error(
      "Select one or more frames/sections/groups (page blocks). No exportable root in selection.",
    );
  }

  sortByLayoutOrder(roots);
  return roots;
}

async function postSelectionState(): Promise<void> {
  const selection = figma.currentPage.selection;
  const roots = selection.filter(
    (n): n is ExportRootNode => Boolean(n && isExportRoot(n)),
  );
  sortByLayoutOrder(roots);
  const names = roots.map((n) => n.name).join(", ");

  figma.ui.postMessage({
    type: "selection-state",
    payload: {
      count: selection.length,
      exportableCount: roots.length,
      selectedNodeName: selection.length === 1 ? (selection[0] ? selection[0].name : null) : null,
      exportableNames: names || null,
      canExport: roots.length > 0,
    },
  });
}

function collectExportRequest(
  root: ExportRootNode,
  pageId: string,
  pageIndex: number,
): ExportRequest {
  const descendants = root.findAll((node) => node.visible);
  const slots = descendants
    .map((node) => createSlotInput(node))
    .filter((slot): slot is SlotInput => slot !== null);

  return {
    page: {
      id: pageId,
      index: pageIndex,
      width: root.width,
      height: root.height,
    },
    slots,
  };
}

function createSlotInput(node: SceneNode): SlotInput | null {
  const parsed = parseSlotName(node.name);
  if (!parsed) {
    return null;
  }

  const position = getAbsolutePosition(node);
  const baseSlot: SlotInput = {
    id: parsed.tag,
    kind: parsed.slotType === "img" ? "image" : "text",
    slotType: parsed.slotType,
    nodeType: node.type,
    x: position.x,
    y: position.y,
    width: "width" in node ? node.width : 0,
    height: "height" in node ? node.height : 0,
    rotation: getRotation(node),
  };

  if (baseSlot.kind === "image") {
    return baseSlot;
  }

  if (node.type !== "TEXT") {
    return baseSlot;
  }

  return {
    id: baseSlot.id,
    kind: baseSlot.kind,
    slotType: baseSlot.slotType,
    nodeType: baseSlot.nodeType,
    x: baseSlot.x,
    y: baseSlot.y,
    width: baseSlot.width,
    height: baseSlot.height,
    rotation: baseSlot.rotation,
    text: createTextPayload(node),
  };
}

function createTextPayload(node: TextNode): TextPayload {
  const mixedStyle =
    isMixed(node.fontName) ||
    isMixed(node.fontSize) ||
    isMixed(node.fills) ||
    isMixed(node.letterSpacing) ||
    isMixed(node.textAlignHorizontal);

  const base = {
    characters: node.characters,
    fontFamily: readFontFamily(node.fontName),
    fontSize: readFontSize(node.fontSize),
    fill: readFill(node.fills),
    letterSpacing: readLetterSpacing(node.letterSpacing),
    textAnchor: mapTextAnchor(node.textAlignHorizontal),
    mixedStyle,
  };

  if (!mixedStyle) return base;

  const segments = getTextSegments(node);
  return segments.length > 0 ? Object.assign({}, base, { segments }) : base;
}

function getTextSegments(node: TextNode): TextSegment[] {
  try {
    const raw = node.getStyledTextSegments(["fontName", "fontSize", "fills", "letterSpacing"]);
    return raw.map(
      (r): TextSegment => ({
        characters: r.characters,
        fontFamily: r.fontName ? r.fontName.family : readFontFamily(node.fontName),
        fontSize: typeof r.fontSize === "number" ? r.fontSize : readFontSize(node.fontSize),
        fill: Array.isArray(r.fills) ? readFillFromPaints(r.fills) : readFill(node.fills),
        letterSpacing: r.letterSpacing && typeof r.letterSpacing === "object" ? r.letterSpacing.value : readLetterSpacing(node.letterSpacing),
      }),
    );
  } catch (_) {
    return [];
  }
}

function readFillFromPaints(paints: ReadonlyArray<Paint>): string {
  const solid = paints.find((p) => p.visible !== false && p.type === "SOLID") as SolidPaint | undefined;
  if (!solid) return "none";
  if (solid.opacity !== undefined && solid.opacity <= 0) return "none";
  return rgbToHex(solid.color, solid.opacity);
}


function parseSlotName(
  name: string,
): { pageToken: string; slotType: SlotValueType; tag: string } | null {
  const match = name.match(SLOT_NAME_RE);
  if (!match) {
    return null;
  }

  return {
    tag: match[1],
    pageToken: match[2],
    slotType: match[4].toLowerCase() as SlotValueType,
  };
}

function getAbsolutePosition(node: SceneNode): { x: number; y: number } {
  const transformNode = node as SceneNode & {
    absoluteTransform?: Transform;
  };

  if (transformNode.absoluteTransform) {
    return {
      x: transformNode.absoluteTransform[0][2],
      y: transformNode.absoluteTransform[1][2],
    };
  }

  return {
    x: "x" in node ? node.x : 0,
    y: "y" in node ? node.y : 0,
  };
}

function getRotation(node: SceneNode): number {
  const rotationNode = node as SceneNode & {
    rotation?: number;
  };

  return typeof rotationNode.rotation === "number" ? rotationNode.rotation : 0;
}

function readFontFamily(fontName: TextNode["fontName"]): string {
  if (isMixed(fontName)) {
    return "Mixed";
  }

  return fontName.family;
}

function readFontSize(fontSize: TextNode["fontSize"]): number {
  return isMixed(fontSize) ? 0 : fontSize;
}

function readLetterSpacing(letterSpacing: TextNode["letterSpacing"]): number {
  if (isMixed(letterSpacing)) {
    return 0;
  }

  return letterSpacing.value;
}

function readFill(fills: TextNode["fills"]): string {
  if (isMixed(fills)) {
    return "none";
  }

  const solid = fills.find(
    (paint): paint is SolidPaint => paint.visible !== false && paint.type === "SOLID",
  );
  if (!solid) {
    return "none";
  }
  if (solid.opacity !== undefined && solid.opacity <= 0) {
    return "none";
  }

  return rgbToHex(solid.color, solid.opacity);
}

function mapTextAnchor(
  align: TextNode["textAlignHorizontal"],
): "start" | "middle" | "end" {
  if (isMixed(align)) {
    return "start";
  }

  switch (align) {
    case "CENTER":
      return "middle";
    case "RIGHT":
      return "end";
    default:
      return "start";
  }
}

function rgbToHex(color: RGB, opacity?: number): string {
  const components = [color.r, color.g, color.b].map((value) => {
    const channel = Math.max(0, Math.min(255, Math.round(value * 255)));
    return channel.toString(16).padStart(2, "0");
  });

  if (opacity === undefined || opacity >= 1) {
    return `#${components.join("")}`.toUpperCase();
  }

  const alpha = Math.max(0, Math.min(255, Math.round(opacity * 255)))
    .toString(16)
    .padStart(2, "0");

  return `#${components.join("")}${alpha}`.toUpperCase();
}

function isMixed<T>(value: T | PluginAPI["mixed"]): value is PluginAPI["mixed"] {
  return value === figma.mixed;
}

function isExportRoot(node: SceneNode | undefined): node is ExportRootNode {
  if (!node) {
    return false;
  }

  return "findAll" in node && "width" in node && "height" in node;
}

type ExportRootNode = SceneNode &
  ChildrenMixin & {
    width: number;
    height: number;
  };
