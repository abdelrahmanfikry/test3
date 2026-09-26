import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, isoDate, addDays, daysFromToday, toMillis, groupBy, clamp } from '../js/utils.js';

test('esc neutralises HTML', () => {
  assert.equal(esc('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
});

test('date helpers are timezone safe', () => {
  assert.equal(isoDate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(isoDate(addDays('2026-02-28', 1)), '2026-03-01');
  assert.equal(isoDate(addDays('2026-03-01', -1)), '2026-02-28');
  assert.equal(daysFromToday(isoDate()), 0);
  assert.equal(daysFromToday(isoDate(addDays(new Date(), 3))), 3);
  assert.equal(daysFromToday(null), null);
});

test('toMillis accepts numbers, Firestore-like timestamps and strings', () => {
  assert.equal(toMillis(5), 5);
  assert.equal(toMillis({ seconds: 2 }), 2000);
  assert.equal(toMillis({ toMillis: () => 7 }), 7);
  assert.equal(toMillis('2026-01-01T00:00:00Z'), Date.UTC(2026, 0, 1));
  assert.equal(toMillis('garbage'), 0);
});

test('groupBy and clamp', () => {
  const m = groupBy([1, 2, 3, 4], x => x % 2);
  assert.deepEqual(m.get(0), [2, 4]);
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(-1, 0, 10), 0);
});
