import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { ValidationError } from './errors.js';
import { isPlainObject } from './validate.js';

/** @typedef {(value: unknown) => string[]} Validator */
/** @typedef {(current: Record<string, unknown>) => Record<string, unknown>} JsonUpdate */

/**
 * Reads and validates a JSON file. Shape problems become a ValidationError naming the file;
 * file system errors are passed through unchanged.
 * @param {string} path
 * @param {Validator} validate
 * @returns {Promise<unknown>}
 */
export async function readValidatedJson(path, validate) {
	const value = parseJson(path, await readFile(path, 'utf8'));
	const problems = validate(value);
	if (problems.length > 0) {
		throw new ValidationError(path, problems);
	}
	return value;
}

/**
 * Writes JSON through a temporary file and a rename, so a crash never leaves a half-written file behind.
 * @param {string} path
 * @param {unknown} value
 */
export async function writeJsonAtomic(path, value) {
	const temporaryPath = `${path}.tmp`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(value, null, '\t')}\n`);
		await rename(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

/**
 * Re-reads the file and writes back the result of `update`, so keys the app does not know about are preserved.
 * A missing file starts as an empty object.
 * @param {string} path
 * @param {JsonUpdate} update
 */
export async function updateJsonFile(path, update) {
	await writeJsonAtomic(path, update(await readObjectOrEmpty(path)));
}

/** @param {string} path */
async function readObjectOrEmpty(path) {
	let text;
	try {
		text = await readFile(path, 'utf8');
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
			return {};
		}
		throw error;
	}
	const value = parseJson(path, text);
	if (!isPlainObject(value)) {
		throw new ValidationError(path, ['must be a JSON object']);
	}
	return value;
}

/**
 * @param {string} path
 * @param {string} text
 * @returns {unknown}
 */
function parseJson(path, text) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new ValidationError(path, [`invalid JSON: ${/** @type {Error} */ (error).message}`]);
	}
}
