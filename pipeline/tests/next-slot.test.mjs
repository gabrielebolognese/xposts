// node --test pipeline/tests/next-slot.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoSlot } from '../bin/next-slot.mjs';

const W = [['09:30', '10:30'], ['13:30', '14:30']];
const at = (iso) => Date.parse(iso); // ISO with an explicit offset
const first = () => 0;
const last = () => 0.9999;

test('free day: a minute inside the morning window', () => {
  for (let i = 0; i < 200; i++) {
    const s = autoSlot(at('2026-11-09T08:00+01:00'), [], W);
    assert.match(s, /^2026-11-09_(09[3-5]\d|10[0-2]\d|1030)$/);
  }
  assert.equal(autoSlot(at('2026-11-09T08:00+01:00'), [], W, 15, first), '2026-11-09_0930');
  assert.equal(autoSlot(at('2026-11-09T08:00+01:00'), [], W, 15, last), '2026-11-09_1030');
});

test('morning taken: afternoon; both taken: next morning', () => {
  assert.equal(autoSlot(at('2026-11-09T08:00+01:00'), ['2026-11-09_0947'], W, 15, first), '2026-11-09_1330');
  assert.equal(autoSlot(at('2026-11-09T08:00+01:00'), ['2026-11-09_0947', '2026-11-09_1412'], W, 15, first), '2026-11-10_0930');
});

test('posts outside the windows do not take a window', () => {
  const others = ['2026-11-09_0900', '2026-11-09_1100', '2026-11-09_1300', '2026-11-09_1500', '2026-11-09_1530', '2026-11-09_1240'];
  assert.equal(autoSlot(at('2026-11-09T08:00+01:00'), others, W, 15, first), '2026-11-09_0930');
});

test('window edges count as inside', () => {
  assert.equal(autoSlot(at('2026-11-09T08:00+01:00'), ['2026-11-09_0930', '2026-11-09_1430'], W, 15, first), '2026-11-10_0930');
});

test('at least 15 minutes ahead', () => {
  assert.equal(autoSlot(at('2026-11-09T10:00+01:00'), [], W, 15, first), '2026-11-09_1015');
  assert.equal(autoSlot(at('2026-11-09T10:20+01:00'), [], W, 15, first), '2026-11-09_1330'); // 10:35 is past the window
  assert.equal(autoSlot(at('2026-11-09T14:20+01:00'), [], W, 15, first), '2026-11-10_0930');
  assert.equal(autoSlot(at('2026-11-09T23:50+01:00'), [], W, 15, first), '2026-11-10_0930'); // the lead crosses midnight
});

test('DST days use Rome wall clock time', () => {
  assert.equal(autoSlot(at('2026-10-25T00:30+02:00'), [], W, 15, first), '2026-10-25_0930'); // clocks go back at 03:00
  assert.equal(autoSlot(at('2027-03-28T00:30+01:00'), [], W, 15, last), '2027-03-28_1030'); // clocks go forward at 02:00
  assert.equal(autoSlot(at('2026-10-25T10:00+01:00'), [], W, 15, first), '2026-10-25_1015');
  assert.equal(autoSlot(at('2027-03-28T10:00+02:00'), [], W, 15, first), '2027-03-28_1015');
});
