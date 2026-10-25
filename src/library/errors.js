/**
 * Data from a file or request does not have the expected shape. Carries every problem found, so they can all be reported at once.
 */
export class ValidationError extends Error {
	/**
	 * @param {string | null} filePath null when the data did not come from a file
	 * @param {string[]} problems
	 */
	constructor(filePath, problems) {
		const summary = problems.join('; ');
		super(filePath === null ? summary : `${filePath}: ${summary}`);
		this.name = 'ValidationError';
		this.filePath = filePath;
		this.problems = problems;
	}
}
