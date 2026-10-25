/** @typedef {import('../../src/library/bootstrap-service.js').Reporter} Reporter */

/**
 * Records every report so tests can assert on what the user would have seen.
 * @implements {Reporter}
 */
export class FakeReporter {
	/** @type {[string, unknown][]} */
	calls = [];

	/**
	 * @param {string} method
	 * @returns {unknown[]}
	 */
	callsTo(method) {
		return this.calls.filter(([name]) => name === method).map(([, argument]) => argument);
	}

	/** @type {Reporter['validationErrors']} */
	validationErrors(errors) {
		this.calls.push(['validationErrors', errors]);
	}

	/** @type {Reporter['warnings']} */
	warnings(warnings) {
		this.calls.push(['warnings', warnings]);
	}

	/** @type {Reporter['nestedDirectories']} */
	nestedDirectories(paths) {
		this.calls.push(['nestedDirectories', paths]);
	}

	/** @type {Reporter['metadataTitles']} */
	metadataTitles(titles) {
		this.calls.push(['metadataTitles', titles]);
	}

	/** @type {Reporter['optionsGenerated']} */
	optionsGenerated(count) {
		this.calls.push(['optionsGenerated', count]);
	}

	/** @type {Reporter['libraryLoaded']} */
	libraryLoaded(library) {
		this.calls.push(['libraryLoaded', library]);
	}
}
