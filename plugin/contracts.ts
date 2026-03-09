export type SlotKind = "text" | "image";
export type SlotValueType = "str" | "i32" | "f64" | "bool" | "img";

export interface ExportRequest {
  page: PageInput;
  slots: SlotInput[];
  staticSvg?: string;
}

export interface PageInput {
  id: string;
  index: number;
  width: number;
  height: number;
}

export interface SlotInput {
  id: string;
  kind: SlotKind;
  slotType: SlotValueType;
  nodeType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  text?: TextPayload;
}

export interface TextSegment {
  characters: string;
  fontFamily: string;
  fontSize: number;
  fill: string;
  letterSpacing: number;
}

export interface TextPayload {
  characters: string;
  fontFamily: string;
  fontSize: number;
  fill: string;
  letterSpacing: number;
  textAnchor: "start" | "middle" | "end";
  mixedStyle: boolean;
  /** When set, text has multiple styles; export as multiple <tspan> with these segments. */
  segments?: TextSegment[];
}

export interface ExportResponse {
  svg: string;
  sidecar: {
    version: string;
    page: PageInput;
    slots: Array<Record<string, unknown>>;
  };
  diagnostics: Diagnostic[];
}

export interface Diagnostic {
  level: "error" | "warning" | "info" | string;
  code: string;
  message: string;
}
