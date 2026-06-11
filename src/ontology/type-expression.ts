export function parseTypeExpression(expression: string): string[] {
  return expression.split('|').map((part) => part.trim()).filter(Boolean);
}

export function normalizeTypeExpression(expression: string, normalizePart: (part: string) => string = (part) => part): string {
  return parseTypeExpression(expression).map(normalizePart).join(' | ');
}

export function isValidTypeExpression(expression: string): boolean {
  const parts = expression.split('|').map((part) => part.trim());
  return parts.length > 0 && parts.every(Boolean);
}
