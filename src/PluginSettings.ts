import type { FrontmatterIgnoreRule } from './ontology/types.ts';
import { DEFAULT_BLOCK_PREFIX } from './ontology/parser.ts';

export class PluginSettings {
  public typeFolder = '_types';
  public schemaPath = '_types/ontology.schema.yaml';
  public entityTypeFields: string[] = ['is-instance', 'type'];
  public queryOnlyLocked = true;
  public cachePath = '.obsidian/ontology-cache.json';
  public autoScaffoldEntities = false;
  public autoUpdateInverses = false;
  public globalTypePath = '';
  public foldersToIgnore: string[] = [];
  public filesToIgnore: string[] = [];
  public frontmatterIgnoreRules: FrontmatterIgnoreRule[] = [];
  public autoApplyBlockPrefix = DEFAULT_BLOCK_PREFIX;
  public initialScaffoldComplete = false;
  public scriptsFolder = '';
}
