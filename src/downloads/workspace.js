import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Where downloads work. It starts with a dot, so the scanner and the change watcher ignore it (DESIGN.md §2.1). */
export const WORKSPACE_NAME = '.soundboard-downloads';

/** @param {string} root */
export function workspaceOf(root) {
	return join(root, WORKSPACE_NAME);
}

/**
 * Deletes whatever an earlier run left behind; jobs never outlive the server.
 * @param {string} root
 */
export async function clearWorkspace(root) {
	await rm(workspaceOf(root), { recursive: true, force: true });
}
