import type { MainCategoryId } from "./categories";
export type EventClassification = {
  category: MainCategoryId;
  subcategory: string;
};
export function classifyExternalEvent(
  title: unknown,
  type?: unknown,
  description?: unknown,
): EventClassification;
