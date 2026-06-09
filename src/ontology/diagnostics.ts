import type { OntologyIndex, OntologyIssue } from './types.ts';

export interface SchemaDiagnostics {
  abstractTypes: number;
  concreteTypes: number;
  circularTypes: string[];
  interfaces: number;
  issues: OntologyIssue[];
  relationDefinitions: number;
  typeFiles: number;
}

function normalizedFolder(folder: string): string {
  return folder.trim().replace(/\/$/, '');
}

export function isSchemaIssue(index: OntologyIndex, issue: OntologyIssue): boolean {
  const typeFolder = normalizedFolder(index.settings.typeFolder);
  if (issue.file === index.settings.schemaPath || (typeFolder && issue.file.startsWith(`${typeFolder}/`))) {
    return true;
  }

  return [
    /^Circular inheritance detected:/,
    /^Unknown parent type /,
    /^Unknown interface /,
    / is implemented but is not marked interface: true$/,
  ].some((pattern) => pattern.test(issue.message));
}

export function buildSchemaDiagnostics(index: OntologyIndex): SchemaDiagnostics {
  const typePaths = new Set<string>();
  let abstractTypes = 0;
  let interfaces = 0;
  let concreteTypes = 0;

  for (const type of index.types.values()) {
    typePaths.add(type.path);
    if (type.isInterface) {
      interfaces++;
    } else if (type.abstract) {
      abstractTypes++;
    } else {
      concreteTypes++;
    }
  }

  return {
    abstractTypes,
    concreteTypes,
    circularTypes: [...index.circularTypes ?? []].sort(),
    interfaces,
    issues: index.issues.filter((issue) => isSchemaIssue(index, issue)),
    relationDefinitions: index.relationDefinitions.size,
    typeFiles: typePaths.size,
  };
}
