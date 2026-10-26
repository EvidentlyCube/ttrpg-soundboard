/** @typedef {Node | string | null | undefined | false} Child */

/**
 * Creates an element. Props: `class`, `style` (an object), `on<Event>` functions as listeners, and anything else as an
 * attribute (`true` sets an empty attribute; `false`, `null` and `undefined` leave it out).
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, unknown>} [props]
 * @param {...(Child | Child[])} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props = {}, ...children) {
	const element = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (value === false || value === null || value === undefined) {
			continue;
		}
		if (key === 'class') {
			element.className = String(value);
		} else if (key === 'style') {
			Object.assign(element.style, value);
		} else if (key.startsWith('on') && typeof value === 'function') {
			element.addEventListener(key.slice(2).toLowerCase(), /** @type {EventListener} */ (value));
		} else {
			element.setAttribute(key, value === true ? '' : String(value));
		}
	}
	for (const child of children.flat()) {
		if (child !== null && child !== undefined && child !== false) {
			element.append(child);
		}
	}
	return element;
}

/**
 * @template {keyof HTMLElementEventMap} T
 * @param {EventTarget} target
 * @param {T} type
 * @param {(event: HTMLElementEventMap[T]) => void} handler
 * @param {AddEventListenerOptions} [options]
 * @returns {() => void} removes the listener
 */
export function on(target, type, handler, options) {
	target.addEventListener(type, /** @type {EventListener} */ (handler), options);
	return () => target.removeEventListener(type, /** @type {EventListener} */ (handler), options);
}

/**
 * @param {string} selector
 * @param {ParentNode} [root]
 */
export function qs(selector, root = document) {
	return root.querySelector(selector);
}

/**
 * @param {string} selector
 * @param {ParentNode} [root]
 */
export function qsa(selector, root = document) {
	return [...root.querySelectorAll(selector)];
}
