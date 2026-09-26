import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workload, rebalanceSuggestions, projectCost, pivot, shiftDependents, dependencyLinks } from '../js/analytics.js';

const users = [{ uid: 'a', displayName: 'أحمد', weeklyCapacity: 10, hourlyRate: 100 }, { uid: 'b', displayName: 'سارة', weeklyCapacity: 40 }];
const today = '2026-09-25';

test('workload sums remaining hours per assignee within window', () => {
  const tasks = [
    { id: 't1', goalId: 'g', assignedToUid: 'a', dueDate: '2026-09-26', plannedHours: 8, timesheets: [{ hours: 2 }] },
    { id: 't2', goalId: 'g', assignedUserIds: ['a', 'b'], dueDate: '2026-09-24', plannedHours: 6 },
    { id: 't3', goalId: 'g', assignedToUid: 'b', dueDate: '2026-12-01', plannedHours: 50 }, // خارج النافذة
    { id: 't4', goalId: 'g', assignedToUid: 'b', dueDate: '2026-09-27' }, // بلا تقدير → 2 ساعة
    { id: 't5', goalId: 'g', assignedToUid: 'a', dueDate: '2026-09-27', completed: true, plannedHours: 9 },
  ];
  const rows = workload(users, tasks, { today });
  const a = rows.find(r => r.uid === 'a'), b = rows.find(r => r.uid === 'b');
  assert.equal(a.hours, 9); // 6 + 3
  assert.equal(a.late, 1);
  assert.equal(a.level, 'high'); // 9 من 10 ساعات
  assert.equal(b.hours, 5); // 3 + 2
  assert.equal(rows[0].uid, 'a'); // الأعلى نسبة أولاً
  const sug = rebalanceSuggestions(workload([{ uid: 'a', weeklyCapacity: 5 }, users[1]], tasks, { today }));
  assert.equal(sug.length, 1);
  assert.equal(sug[0].to.uid, 'b');
});

test('projectCost multiplies hours by member rate and compares with budget', () => {
  const project = { id: 'g', budget: 1000 };
  const tasks = [{ goalId: 'g', timesheets: [{ uid: 'a', hours: 5 }, { uid: 'b', hours: 3 }] }, { goalId: 'x', timesheets: [{ uid: 'a', hours: 99 }] }];
  const c = projectCost(project, tasks, users, { defaultRate: 50 });
  assert.equal(c.hours, 8);
  assert.equal(c.cost, 650);
  assert.equal(c.pct, 65);
  assert.equal(c.over, false);
  assert.deepEqual(c.byUser[0], { uid: 'a', cost: 500 });
});

test('pivot builds project × member matrix with totals', () => {
  const goals = [{ id: 'g1', name: 'A' }, { id: 'g2', name: 'B' }];
  const tasks = [{ goalId: 'g1', assignedToUid: 'a' }, { goalId: 'g1', assignedToUid: 'b', completed: true }, { goalId: 'g2', assignedUserIds: ['a'] }, { goalId: 'g1', parentId: 'p', assignedToUid: 'a' }];
  const p = pivot(goals, users, tasks, 'open');
  assert.equal(p.rows.length, 2);
  assert.deepEqual(p.rows[0].cells, [1, 0]);
  assert.deepEqual(p.totals, [2, 0]);
  assert.equal(p.grand, 2);
  assert.equal(pivot(goals, users, tasks, 'done').grand, 1);
});

test('shiftDependents pushes blocked tasks after the new end date, transitively', () => {
  const tasks = [
    { id: 'a', startDate: '2026-09-01', dueDate: '2026-09-05' },
    { id: 'b', startDate: '2026-09-06', dueDate: '2026-09-10', blockedBy: ['a'] },
    { id: 'c', startDate: '2026-09-11', dueDate: '2026-09-12', blockedBy: ['b'] },
    { id: 'd', startDate: '2026-09-20', dueDate: '2026-09-22', blockedBy: ['a'] }, // بعيدة بما يكفي
    { id: 'e', startDate: '2026-09-06', dueDate: '2026-09-07', blockedBy: ['a'], completed: true },
  ];
  const out = shiftDependents(tasks, 'a', { startDate: '2026-09-03', dueDate: '2026-09-08' });
  assert.deepEqual(out.map(x => x.id), ['b', 'c']);
  assert.deepEqual(out[0], { id: 'b', startDate: '2026-09-09', dueDate: '2026-09-13' });
  assert.deepEqual(out[1], { id: 'c', startDate: '2026-09-14', dueDate: '2026-09-15' });
  assert.deepEqual(shiftDependents(tasks, 'a', { startDate: '2026-08-20', dueDate: '2026-08-25' }), []);
});

test('dependencyLinks only links tasks present in the list', () => {
  const links = dependencyLinks([{ id: 'a' }, { id: 'b', blockedBy: ['a', 'zzz'] }]);
  assert.deepEqual(links, [{ from: 'a', to: 'b' }]);
});
