'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Handlers that start, advance or cash out a run must ignore synthetic events.
const expected = {
  'games/capybara_catch.html': 4,
  'games/capybara_clicker.html': 3,
  'games/capybara_dash.html': 2,
  'games/capybara_fisher.html': 4,
  'games/capybara_spin.html': 2,
  'games/capybara_stack.html': 2,
  'games/whack_a_capy.html': 4,
};

for (const [file, count] of Object.entries(expected)) {
  const source = read(file);
  assert.ok((source.match(/!e\.isTrusted/g) || []).length >= count,
    `${file} is missing an isTrusted guard`);
  // capycoins-autoplay.js rewrites the page when it finds this exact literal.
  assert.doesNotMatch(source, /isTrusted===false/,
    `${file} contains the bookmarklet's strippable guard literal`);
}

console.log(`anticheat static checks passed (${Object.keys(expected).length} games)`);
