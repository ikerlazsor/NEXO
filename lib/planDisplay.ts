/** Quita sufijos demo tipo «(valorar)» / «(rate)» del título de un plan. */
export function stripPlanTitleSuffix(title: string): string {
    return String(title || '')
        .replace(/\s*\((valorar|rate)\)\s*$/i, '')
        .trim();
}
