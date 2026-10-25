/**
 * Typed publish/subscribe for `{ type, ...payload }` events. A throwing handler never stops the others from
 * running: its error goes to `onHandlerError`, so a UI bug cannot leave playback state half-updated.
 * @template {{ type: string }} E
 */
export class EventEmitter {
	/** @type {Map<string, Set<(event: any) => void>>} */
	#handlers = new Map();
	#onHandlerError;

	/** @param {(error: unknown, event: E) => void} [onHandlerError] */
	constructor(onHandlerError = (error) => {
		throw error;
	}) {
		this.#onHandlerError = onHandlerError;
	}

	/**
	 * @template {E['type']} T
	 * @param {T} type
	 * @param {(event: Extract<E, { type: T }>) => void} handler
	 * @returns {() => void} unsubscribes
	 */
	on(type, handler) {
		let handlers = this.#handlers.get(type);
		if (!handlers) {
			handlers = new Set();
			this.#handlers.set(type, handlers);
		}
		handlers.add(handler);
		return () => this.off(type, handler);
	}

	/**
	 * @template {E['type']} T
	 * @param {T} type
	 * @param {(event: Extract<E, { type: T }>) => void} handler
	 */
	off(type, handler) {
		this.#handlers.get(type)?.delete(handler);
	}

	/** @param {E} event */
	emit(event) {
		for (const handler of [...(this.#handlers.get(event.type) ?? [])]) {
			try {
				handler(event);
			} catch (error) {
				this.#onHandlerError(error, event);
			}
		}
	}
}
