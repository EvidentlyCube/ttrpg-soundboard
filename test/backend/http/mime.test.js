import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_CONTENT_TYPES, contentTypeFor } from '../../../src/http/mime.js';

describe('contentTypeFor', () => {
	it('knows the static file types the app uses', () => {
		assert.equal(contentTypeFor('index.html'), 'text/html; charset=utf-8');
		assert.equal(contentTypeFor('app/main.js'), 'text/javascript; charset=utf-8');
		assert.equal(contentTypeFor('styles.CSS'), 'text/css; charset=utf-8');
		assert.equal(contentTypeFor('icon.svg'), 'image/svg+xml');
	});

	it('falls back to a generic binary type', () => {
		assert.equal(contentTypeFor('archive.xyz'), 'application/octet-stream');
		assert.equal(contentTypeFor('README'), 'application/octet-stream');
	});
});

describe('AUDIO_CONTENT_TYPES', () => {
	it('maps each supported format', () => {
		assert.deepEqual(AUDIO_CONTENT_TYPES, { mp3: 'audio/mpeg', ogg: 'audio/ogg' });
	});
});
