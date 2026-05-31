import { Project } from '../core/project.js';

/**
 * Resolver function that maps a projectId to a fully loaded Project.
 *
 * In stdio mode, the resolver is replaced by a single Project instance.
 * In daemon mode, the resolver looks up the projectId in the registry
 * and returns the corresponding Project.
 *
 * If projectId is empty, the resolver should attempt to use the default
 * project from the registry.
 */
export type ProjectResolver = (projectId: string) => Promise<Project>;
