import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { startServer } from '../../../src/http/server.js';
import { copyFixture, createTmpTree } from '../../helpers/tmp-tree.js';

/**
 * Starts the real server on a temporary library.
 * @param {'example' | import('../../helpers/tmp-tree.js').TreeSpec} [library] a copy of the example fixture, or a tree to build
 * @returns {Promise<{ url: string, root: string, stop: () => Promise<void> }>}
 */
export async function startSoundboardServer(library = 'example') {
	const copy = library === 'example' ? await copyFixture('example_soundboard') : await createTmpTree(library);
	const reporter = /** @type {ConstructorParameters<typeof BootstrapService>[0]['reporter']} */ (new Proxy({}, { get: () => () => {} }));
	const outcome = await new BootstrapService({ prompter: { confirm: async () => true }, reporter }).run(copy.root);
	if (outcome.status !== 'ready') {
		throw new Error(`The library did not load: ${outcome.status}`);
	}
	const server = await startServer({
		library: outcome.library,
		settings: outcome.settings,
		port: 0,
		logError: (error) => console.error('SERVER ERROR', error),
	});
	return {
		url: server.url,
		root: copy.root,
		async stop() {
			await server.close();
			await copy.remove();
		},
	};
}
