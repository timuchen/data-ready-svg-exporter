/**
 * Export core: builds SVG and sidecar JSON from collected Figma data.
 */

import type {
  Diagnostic,
  ExportRequest,
  ExportResponse,
  SlotInput,
  TextPayload,
} from "./contracts";

function trimNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapGroupWithRotation(slot: SlotInput, inner: string): string {
  const idAttr = ` id="${escapeXml(slot.id)}"`;
  if (Math.abs(slot.rotation) < 1e-9) return `<g${idAttr}>\n${inner}\n</g>`;
  const cx = slot.x + slot.width / 2;
  const cy = slot.y + slot.height / 2;
  const transform = ` transform="rotate(${trimNumber(slot.rotation)}, ${trimNumber(cx)}, ${trimNumber(cy)})"`;
  return `<g${idAttr}${transform}>\n${inner}\n</g>`;
}

function renderTextSlot(slot: SlotInput, text: TextPayload): string {
  const baseY = slot.y + (text.segments?.[0]?.fontSize ?? text.fontSize);
  let tspans: string;
  if (text.segments && text.segments.length > 0) {
    const parts = text.segments.map((seg, i) => {
      const segY = slot.y + seg.fontSize;
      const span =
        i === 0
          ? `<tspan x="${trimNumber(slot.x)}" y="${trimNumber(segY)}" fill="${escapeXml(seg.fill)}" font-family="${escapeXml(seg.fontFamily)}" font-size="${trimNumber(seg.fontSize)}" letter-spacing="${trimNumber(seg.letterSpacing)}">${escapeXml(seg.characters)}</tspan>`
          : `<tspan fill="${escapeXml(seg.fill)}" font-family="${escapeXml(seg.fontFamily)}" font-size="${trimNumber(seg.fontSize)}" letter-spacing="${trimNumber(seg.letterSpacing)}">${escapeXml(seg.characters)}</tspan>`;
      return span;
    });
    tspans = parts.join("\n  ");
  } else {
    tspans = `<tspan x="${trimNumber(slot.x)}" y="${trimNumber(baseY)}">${escapeXml(text.characters)}</tspan>`;
  }
  const textAnchor = escapeXml(text.textAnchor);
  const firstSeg = text.segments?.[0];
  const fill = firstSeg ? escapeXml(firstSeg.fill) : escapeXml(text.fill);
  const fontFamily = firstSeg ? escapeXml(firstSeg.fontFamily) : escapeXml(text.fontFamily);
  const fontSize = firstSeg ? trimNumber(firstSeg.fontSize) : trimNumber(text.fontSize);
  const letterSpacing = firstSeg ? trimNumber(firstSeg.letterSpacing) : trimNumber(text.letterSpacing);
  const inner = `<text fill="${fill}" font-family="${fontFamily}" font-size="${fontSize}" letter-spacing="${letterSpacing}" text-anchor="${textAnchor}" xml:space="preserve">
  ${tspans}
</text>`;
  return wrapGroupWithRotation(slot, inner);
}

function renderImageSlot(slot: SlotInput): string {
  const inner = `<rect x="${trimNumber(slot.x)}" y="${trimNumber(slot.y)}" width="${trimNumber(slot.width)}" height="${trimNumber(slot.height)}" fill="none"/>`;
  return wrapGroupWithRotation(slot, inner);
}

function diagnosticError(code: string, message: string): Diagnostic {
  return { level: "error", code, message };
}

function diagnosticWarning(code: string, message: string): Diagnostic {
  return { level: "warning", code, message };
}

export function buildExportResponse(request: ExportRequest): ExportResponse {
  const { page, slots: inputSlots, staticSvg } = request;
  const diagnostics: Diagnostic[] = [];
  const svgParts: string[] = [];
  const sidecarSlots: Array<Record<string, unknown>> = [];

  for (const slot of inputSlots) {
    if (slot.kind === "text") {
      const text = slot.text;
      if (!text) {
        diagnostics.push(
          diagnosticError("TEXT_SLOT_MISSING_TEXT", `slot ${slot.id} does not contain text payload`),
        );
        continue;
      }
      if (text.mixedStyle && (!text.segments || text.segments.length === 0)) {
        diagnostics.push(
          diagnosticWarning(
            "TEXT_SLOT_MIXED_STYLE",
            `slot ${slot.id}: mixed styles exported with first style only (segment API unavailable)`,
          ),
        );
      }
      if (Math.abs(slot.rotation) > 1e-9) {
        diagnostics.push(
          diagnosticWarning("TEXT_SLOT_ROTATED", `slot ${slot.id} exported with transform (rotated)`),
        );
      }
      svgParts.push(renderTextSlot(slot, text));
      sidecarSlots.push({
        id: slot.id,
        type: slot.slotType,
        nodeType: slot.nodeType,
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        fontFamily: text.fontFamily,
        fontSize: text.fontSize,
        fill: text.fill,
        text: text.characters,
      });
    } else {
      svgParts.push(renderImageSlot(slot));
      sidecarSlots.push({
        id: slot.id,
        type: slot.slotType,
        nodeType: slot.nodeType,
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        fit: "contain",
      });
    }
  }

  let svg = `<svg width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" fill="none" style="background:transparent">`;
  if (staticSvg && staticSvg.trim()) {
    svg += "\n  " + staticSvg.trim();
  } else {
    svg += "\n  <!-- static background serialization is pending -->";
  }
  for (const part of svgParts) {
    svg += "\n  " + part.replace(/\n/g, "\n  ");
  }
  svg += "\n</svg>";

  return {
    svg,
    sidecar: {
      version: "1.0",
      page: { id: page.id, index: page.index, width: page.width, height: page.height },
      slots: sidecarSlots,
    },
    diagnostics,
  };
}
