import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { ChangeWatcher } from '../../../src/library/change-watcher.js';
import { startServer } from '../../../src/http/server.js';
import { copyFixture, createTmpTree } from '../../helpers/tmp-tree.js';

/**
 * Starts the real server on a temporary library, wired like src/cli/main.js: with the change watcher, so files that
 * change in the folder show up in the page. Downloads are left out.
 * @param {'example' | import('../../helpers/tmp-tree.js').TreeSpec} [library] a copy of the example fixture, or a tree to build
 * @returns {Promise<{ url: string, root: string, stop: () => Promise<void> }>}
 */
export async function startSoundboardServer(library = 'example') {
	const copy = library === 'example' ? await copyFixture('example_soundboard') : await createTmpTree(library);
	const reporter = /** @type {ConstructorParameters<typeof BootstrapService>[0]['reporter']} */ (new Proxy({}, { get: () => () => {} }));
	const watcher = new ChangeWatcher({ root: copy.root, log: () => {} });
	const bootstrap = new BootstrapService({ prompter: { confirm: async () => true }, reporter, updateSettingsFile: watcher.updateFile });
	const outcome = await bootstrap.run(copy.root);
	if (outcome.status !== 'ready') {
		throw new Error(`The library did not load: ${outcome.status}`);
	}
	await watcher.start(outcome.scan);
	const server = await startServer({
		library: outcome.library,
		settings: outcome.settings,
		problems: outcome.problems,
		port: 0,
		logError: (error) => console.error('SERVER ERROR', error),
		watcher,
		refresh: () => watcher.refresh(() => bootstrap.refresh(copy.root)),
	});
	return {
		url: server.url,
		root: copy.root,
		async stop() {
			watcher.stop();
			await server.close();
			await copy.remove();
		},
	};
}
