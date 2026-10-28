/**
 * Cuts program output into lines the way a terminal shows it. A line ended by a carriage return alone is progress that
 * the next line overwrites, so it is reported as `transient`; `\r\n` ends an ordinary line.
 */
export class LineSplitter {
	#onLine;
	#current = '';
	#afterCarriageReturn = false;

	/** @param {(text: string, transient: boolean) => void} onLine */
	constructor(onLine) {
		this.#onLine = onLine;
	}

	/** @param {string} chunk */
	push(chunk) {
		for (const character of chunk) {
			if (this.#afterCarriageReturn) {
				this.#afterCarriageReturn = false;
				if (character === '\n') {
					this.#emit(false);
					continue;
				}
				this.#emit(true);
			}
			if (character === '\r') {
				this.#afterCarriageReturn = true;
			} else if (character === '\n') {
				this.#emit(false);
			} else {
				this.#current += character;
			}
		}
	}

	/** Reports what is left after the output ended. */
	end() {
		if (this.#afterCarriageReturn || this.#current !== '') {
			this.#afterCarriageReturn = false;
			this.#emit(false);
		}
	}

	/** @param {boolean} transient */
	#emit(transient) {
		const text = this.#current;
		this.#current = '';
		// A bare "\r" between two progress updates says nothing by itself.
		if (transient && text === '') {
			return;
		}
		this.#onLine(text, transient);
	}
}
