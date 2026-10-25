import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { TerminalPrompter } from '../../../src/cli/prompter.js';

/**
 * @param {(input: PassThrough) => void} type what the user does once the question is shown
 */
async function ask(type) {
	const input = new PassThrough();
	const output = new PassThrough();
	let shown = '';
	output.on('data', (chunk) => {
		shown += chunk;
	});
	const answer = new TerminalPrompter(input, output).confirm('Continue?');
	type(input);
	return { answer: await answer, shown };
}

describe('TerminalPrompter', () => {
	it('shows the question with a y/N hint', async () => {
		const { shown } = await ask((input) => input.write('y\n'));
		assert.equal(shown, 'Continue? [y/N] ');
	});

	it('accepts y and yes in any case', async () => {
		for (const typed of ['y', 'Y', 'yes', 'YES', ' yes ']) {
			assert.equal((await ask((input) => input.write(`${typed}\n`))).answer, true, typed);
		}
	});

	it('treats anything else, including just Enter, as no', async () => {
		for (const typed of ['', 'n', 'no', 'yep', 'sure']) {
			assert.equal((await ask((input) => input.write(`${typed}\n`))).answer, false, typed);
		}
	});

	it('treats closed input as no', async () => {
		assert.equal((await ask((input) => input.end())).answer, false);
	});

	it('can ask several questions on the same input', async () => {
		const input = new PassThrough();
		const prompter = new TerminalPrompter(input, new PassThrough());
		const first = prompter.confirm('First?');
		input.write('y\n');
		assert.equal(await first, true);
		const second = prompter.confirm('Second?');
		input.write('n\n');
		assert.equal(await second, false);
		prompter.close();
	});

	it('keeps answers typed ahead for the following questions', async () => {
		const input = new PassThrough();
		const prompter = new TerminalPrompter(input, new PassThrough());
		const first = prompter.confirm('First?');
		input.write('y\nn\ny\n');
		assert.equal(await first, true);
		assert.equal(await prompter.confirm('Second?'), false);
		assert.equal(await prompter.confirm('Third?'), true);
		prompter.close();
	});

	it('answers no to every question after the input closes', async () => {
		const input = new PassThrough();
		const prompter = new TerminalPrompter(input, new PassThrough());
		input.end('y\n');
		assert.equal(await prompter.confirm('First?'), true);
		assert.equal(await prompter.confirm('Second?'), false);
	});

	it('answers no once closed', async () => {
		const prompter = new TerminalPrompter(new PassThrough(), new PassThrough());
		prompter.close();
		assert.equal(await prompter.confirm('Anything?'), false);
	});
});
