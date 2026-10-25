/** Answers questions from a fixed script and records what was asked. An unscripted question fails the test. */
export class FakePrompter {
	/** @type {string[]} */
	questions = [];
	#answers;

	/** @param {boolean[]} [answers] */
	constructor(answers = []) {
		this.#answers = [...answers];
	}

	/** @param {string} question */
	async confirm(question) {
		this.questions.push(question);
		const answer = this.#answers.shift();
		if (answer === undefined) {
			throw new Error(`Unexpected question: ${question}`);
		}
		return answer;
	}
}
