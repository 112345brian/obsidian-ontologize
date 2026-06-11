import type { FrontmatterIgnoreRule } from './ontology/types.ts';

export class PluginSettings {
  public typeFolder = '_types';
  public schemaPath = '_types/ontology.schema.yaml';
  public entityTypeFields: string[] = ['is-instance', 'type'];
  public queryOnlyLocked = true;
  public cachePath = '.obsidian/ontology-cache.json';
  public autoScaffoldEntities = false;
  public autoUpdateInverses = false;
  public foldersToIgnore: string[] = [];
  public filesToIgnore: string[] = [];
  public frontmatterIgnoreRules: FrontmatterIgnoreRule[] = [];
}
