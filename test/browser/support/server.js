import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { startServer } from '../../../src/http/server.js';
import { copyFixture } from '../../helpers/tmp-tree.js';

/**
 * Starts the real server on a temporary copy of the example fixture.
 * @returns {Promise<{ url: string, root: string, stop: () => Promise<void> }>}
 */
export async function startSoundboardServer() {
	const copy = await copyFixture('example_soundboard');
	const reporter = /** @type {ConstructorParameters<typeof BootstrapService>[0]['reporter']} */ (new Proxy({}, { get: () => () => {} }));
	const outcome = await new BootstrapService({ prompter: { confirm: async () => true }, reporter }).run(copy.root);
	if (outcome.status !== 'ready') {
		throw new Error(`The fixture did not load: ${outcome.status}`);
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
