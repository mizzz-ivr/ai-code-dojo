import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readHtml = () => readFile(new URL('../../starter/index.html', import.meta.url), 'utf8');

test('セマンティックなプロフィールカードとGridを定義する', async () => {
  const html = await readHtml();
  assert.match(html, /<article\b[^>]*class=["'][^"']*\bprofile-card\b[^"']*["'][^>]*>/i);
  assert.match(html, /<h2\b[^>]*>\s*Mika Sato\s*<\/h2>/i);
  assert.match(html, /\.profile-card\s*\{[^}]*display\s*:\s*grid\s*;/is);
  assert.match(html, /@media\s*\(\s*max-width\s*:\s*600px\s*\)/i);
});
