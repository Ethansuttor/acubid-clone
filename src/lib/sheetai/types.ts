// Sheet analysis: read a plan sheet's title block so sheets name themselves
// and calibrate themselves from the stated drawing scale. Behind an interface
// so the model or prompting strategy can be swapped independently of the UI.

export interface SheetInfo {
  /** e.g. "E-101" */
  sheetNumber: string | null;
  /** e.g. "POWER PLAN - LEVEL 1" */
  sheetTitle: string | null;
  /** Verbatim scale text found on the sheet, e.g. `1/4" = 1'-0"`. */
  scaleText: string | null;
  /** 0..1 self-reported confidence. */
  confidence: number;
}

export interface SheetAnalyzer {
  readonly model: string;
  analyzeSheet(pngDataUrl: string): Promise<SheetInfo>;
}
