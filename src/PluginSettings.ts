import type { FrontmatterIgnoreRule } from './ontology/types.ts';

export class PluginSettings {
  public typeFolder = '_types';
  public schemaPath = '_types/ontology.schema.yaml';
  public entityTypeFields: string[] = ['instance_of', 'type'];
  public queryOnlyLocked = true;
  public cachePath = '.obsidian/ontology-cache.json';
  public autoUpdateInverses = false;
  public validationThreshold = 100;
  public foldersToIgnore: string[] = [];
  public filesToIgnore: string[] = [];
  public frontmatterIgnoreRules: FrontmatterIgnoreRule[] = [];
}
