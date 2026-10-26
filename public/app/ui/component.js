/**
 * Base for UI components (DESIGN.md §9.4): `render()` builds the element once, `mount()` attaches it, and `destroy()`
 * removes it along with every subscription registered through `own()`.
 */
export class Component {
	/** @type {(() => void)[]} */
	#cleanups = [];
	/** @type {HTMLElement | null} */
	#element = null;

	get element() {
		if (!this.#element) {
			throw new Error(`${this.constructor.name} is not mounted`);
		}
		return this.#element;
	}

	/** @param {ParentNode} parent */
	mount(parent) {
		this.#element = this.render();
		parent.append(this.#element);
		return this;
	}

	/** @returns {HTMLElement} */
	render() {
		throw new Error(`${this.constructor.name} must implement render()`);
	}

	/**
	 * Registers something to undo on `destroy()`, such as an event unsubscribe function.
	 * @param {() => void} cleanup
	 */
	own(cleanup) {
		this.#cleanups.push(cleanup);
	}

	destroy() {
		for (const cleanup of this.#cleanups.splice(0)) {
			cleanup();
		}
		this.#element?.remove();
		this.#element = null;
	}
}
