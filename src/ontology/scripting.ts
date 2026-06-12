import type { OntologyEntity, OntologyIndex, OntologyIssue } from './types.ts';

export type EntityValidateHandler = (entity: OntologyEntity, api: OntologizeAPI) => void;
export type EntitySaveHandler = (entity: OntologyEntity, api: OntologizeAPI) => void | Promise<void>;
export type IndexReadyHandler = (api: OntologizeAPI) => void | Promise<void>;

export interface EntityActionOptions {
  /** If provided, only show this action for entities of these types. */
  types?: string[];
  /** Called to render the action UI into the container. */
  run(entity: OntologyEntity, container: HTMLElement, api: OntologizeAPI): void | Promise<void>;
}

export interface RegisteredEntityAction {
  label: string;
  options: EntityActionOptions;
}

/** Stable public API injected into user scripts as `ontologize`. */
export interface OntologizeAPI {
  /** The live ontology index. Always reflects the most recent rebuild. */
  readonly index: OntologyIndex;
  /** Run an ontology query string and return matching entities. */
  query(queryString: string): OntologyEntity[];
  /** Push a custom validation issue into the live index. */
  issue(path: string, message: string, severity?: OntologyIssue['severity']): void;
  /** Write frontmatter keys to an entity note. */
  updateFrontmatter(path: string, update: Record<string, unknown>): Promise<void>;
  /** Register a handler for a named lifecycle event. */
  on(event: 'index:ready', handler: IndexReadyHandler): void;
  on(event: 'entity:save', handler: EntitySaveHandler): void;
  on(event: 'entity:validate', handler: EntityValidateHandler): void;
  /** UI extension points. */
  ui: {
    /** Register a custom action panel shown in the entity actions modal. */
    registerEntityAction(label: string, options: EntityActionOptions): void;
  };
}

export class ScriptHookRegistry {
  public indexReadyHandlers: IndexReadyHandler[] = [];
  public entitySaveHandlers: EntitySaveHandler[] = [];
  public entityValidateHandlers: EntityValidateHandler[] = [];
  public entityActions: RegisteredEntityAction[] = [];

  public clear(): void {
    this.indexReadyHandlers = [];
    this.entitySaveHandlers = [];
    this.entityValidateHandlers = [];
    this.entityActions = [];
  }
}
