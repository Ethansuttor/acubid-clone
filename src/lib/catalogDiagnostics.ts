import type { Assembly, AssemblyItem, Item } from "./types";

export type CatalogDiagnosticIssueKind =
  | "zero-cost-item"
  | "zero-labor-item"
  | "duplicate-item-code"
  | "duplicate-assembly-code"
  | "empty-assembly"
  | "missing-component-item"
  | "missing-component-assembly";

export interface CatalogDiagnosticIssue {
  kind: CatalogDiagnosticIssueKind;
  severity: "error" | "warning";
  title: string;
  detail: string;
  itemId?: string;
  assemblyId?: string;
  assemblyItemId?: string;
  code?: string;
}

export interface CatalogDiagnosticsSummary {
  totalItems: number;
  totalAssemblies: number;
  totalAssemblyItems: number;
  zeroCostCount: number;
  zeroLaborCount: number;
  duplicateItemCodeCount: number;
  duplicateAssemblyCodeCount: number;
  emptyAssemblyCount: number;
  missingComponentCount: number;
}

export interface CatalogDiagnosticsReport {
  healthy: boolean;
  issues: CatalogDiagnosticIssue[];
  summary: CatalogDiagnosticsSummary;
}

/**
 * Pure catalog diagnostic engine. Analyzes items, assemblies, and assembly-item
 * relations to detect zero costs, missing labor units, duplicate codes, empty
 * assemblies, and dangling relational references.
 *
 * Guaranteed 100% pure: zero React/IO dependencies, no mutation of inputs,
 * deterministic ordering.
 */
export function diagnoseCatalog(
  items: Item[],
  assemblies: Assembly[],
  assemblyItems: AssemblyItem[]
): CatalogDiagnosticsReport {
  const safeItems = Array.isArray(items) ? items : [];
  const safeAssemblies = Array.isArray(assemblies) ? assemblies : [];
  const safeAssemblyItems = Array.isArray(assemblyItems) ? assemblyItems : [];

  const issues: CatalogDiagnosticIssue[] = [];

  // Index items and assemblies for O(1) relational lookups
  const itemMap = new Map<string, Item>();
  const itemsByCode = new Map<string, Item[]>();
  for (const item of safeItems) {
    if (item && item.id) itemMap.set(item.id, item);
    const normCode = (item?.code ?? "").trim().toLowerCase();
    if (normCode !== "") {
      const group = itemsByCode.get(normCode) ?? [];
      group.push(item);
      itemsByCode.set(normCode, group);
    }
  }

  const assemblyMap = new Map<string, Assembly>();
  const assembliesByCode = new Map<string, Assembly[]>();
  for (const assembly of safeAssemblies) {
    if (assembly && assembly.id) assemblyMap.set(assembly.id, assembly);
    const normCode = (assembly?.code ?? "").trim().toLowerCase();
    if (normCode !== "") {
      const group = assembliesByCode.get(normCode) ?? [];
      group.push(assembly);
      assembliesByCode.set(normCode, group);
    }
  }

  const componentCountByAssembly = new Map<string, number>();
  for (const ai of safeAssemblyItems) {
    if (ai && ai.assembly_id) {
      componentCountByAssembly.set(
        ai.assembly_id,
        (componentCountByAssembly.get(ai.assembly_id) ?? 0) + 1
      );
    }
  }

  let zeroCostCount = 0;
  let zeroLaborCount = 0;
  let duplicateItemCodeCount = 0;
  let duplicateAssemblyCodeCount = 0;
  let emptyAssemblyCount = 0;
  let missingComponentCount = 0;

  // 1. Analyze Items: zero cost, zero labor, duplicate codes
  for (const item of safeItems) {
    if (!item) continue;
    const isZeroCost = !Number.isFinite(item.material_cost) || item.material_cost <= 0;
    if (isZeroCost) {
      zeroCostCount += 1;
      const formattedCost = Number.isFinite(item.material_cost) ? item.material_cost.toFixed(2) : "0.00";
      issues.push({
        kind: "zero-cost-item",
        severity: "warning",
        title: "Zero material cost",
        detail: `Item "${item.description || item.code || item.id}" has no material cost ($${formattedCost}).`,
        itemId: item.id,
        code: item.code || undefined,
      });
    }

    const isZeroLabor = !Number.isFinite(item.labor_hours) || item.labor_hours <= 0;
    if (isZeroLabor) {
      zeroLaborCount += 1;
      const laborHours = Number.isFinite(item.labor_hours) ? item.labor_hours : 0;
      issues.push({
        kind: "zero-labor-item",
        severity: "warning",
        title: "Zero labor hours",
        detail: `Item "${item.description || item.code || item.id}" has no labor hours (${laborHours} hr).`,
        itemId: item.id,
        code: item.code || undefined,
      });
    }

    const normCode = (item.code ?? "").trim().toLowerCase();
    if (normCode !== "") {
      const group = itemsByCode.get(normCode);
      if (group && group.length > 1) {
        duplicateItemCodeCount += 1;
        issues.push({
          kind: "duplicate-item-code",
          severity: "error",
          title: "Duplicate item code",
          detail: `Item code "${item.code}" is shared by ${group.length} items.`,
          itemId: item.id,
          code: item.code,
        });
      }
    }
  }

  // 2. Analyze Assemblies: duplicate codes, empty assemblies
  for (const assembly of safeAssemblies) {
    if (!assembly) continue;
    const normCode = (assembly.code ?? "").trim().toLowerCase();
    if (normCode !== "") {
      const group = assembliesByCode.get(normCode);
      if (group && group.length > 1) {
        duplicateAssemblyCodeCount += 1;
        issues.push({
          kind: "duplicate-assembly-code",
          severity: "error",
          title: "Duplicate assembly code",
          detail: `Assembly code "${assembly.code}" is shared by ${group.length} assemblies.`,
          assemblyId: assembly.id,
          code: assembly.code,
        });
      }
    }

    const count = componentCountByAssembly.get(assembly.id) ?? 0;
    if (count === 0) {
      emptyAssemblyCount += 1;
      issues.push({
        kind: "empty-assembly",
        severity: "error",
        title: "Empty assembly",
        detail: `Assembly "${assembly.name || assembly.code || assembly.id}" has no component items.`,
        assemblyId: assembly.id,
        code: assembly.code || undefined,
      });
    }
  }

  // 3. Analyze AssemblyItems: missing parent assembly, missing component item
  for (const ai of safeAssemblyItems) {
    if (!ai) continue;
    if (!assemblyMap.has(ai.assembly_id)) {
      missingComponentCount += 1;
      issues.push({
        kind: "missing-component-assembly",
        severity: "error",
        title: "Missing parent assembly",
        detail: `Assembly component references missing assembly ID "${ai.assembly_id}".`,
        assemblyItemId: ai.id,
        assemblyId: ai.assembly_id,
        itemId: ai.item_id,
      });
    }

    if (!itemMap.has(ai.item_id)) {
      missingComponentCount += 1;
      const parentAssembly = assemblyMap.get(ai.assembly_id);
      const parentName = parentAssembly ? ` in assembly "${parentAssembly.name || parentAssembly.code}"` : "";
      issues.push({
        kind: "missing-component-item",
        severity: "error",
        title: "Missing component item",
        detail: `Assembly component references missing item ID "${ai.item_id}"${parentName}.`,
        assemblyItemId: ai.id,
        assemblyId: ai.assembly_id,
        itemId: ai.item_id,
      });
    }
  }

  return {
    healthy: issues.length === 0,
    issues,
    summary: {
      totalItems: safeItems.length,
      totalAssemblies: safeAssemblies.length,
      totalAssemblyItems: safeAssemblyItems.length,
      zeroCostCount,
      zeroLaborCount,
      duplicateItemCodeCount,
      duplicateAssemblyCodeCount,
      emptyAssemblyCount,
      missingComponentCount,
    },
  };
}
