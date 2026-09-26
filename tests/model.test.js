import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectStages, taskStage, stagePatch, completionPatch, blockers, nextOccurrence, checklistProgress, subtaskProgress, projectStats, cloneFromTemplate, DEFAULT_STAGES, stageAutomationPatch, wipStatus } from '../js/model.js';

const project = { id: 'g', stages: [{ id: 's1', name: 'جديد', done: false }, { id: 's2', name: 'جارٍ', done: false, limit: 1, autoAssign: 'u2' }, { id: 's3', name: 'منجز', done: true }], milestones: [{ id: 'm', done: true }, { id: 'n', done: false }] };

test('stages fall back to defaults and resolve task stage logically', () => {
  assert.equal(projectStages({}).length, DEFAULT_STAGES.length);
  assert.equal(taskStage({ stageId: 's2' }, project).id, 's2');
  assert.equal(taskStage({ stageId: 'missing', completed: true }, project).id, 's3');
  assert.equal(taskStage({}, project).id, 's1');
});

test('stagePatch / completionPatch keep completed and stageId in sync', () => {
  assert.deepEqual(stagePatch(project.stages[2]), { stageId: 's3', completed: true });
  assert.deepEqual(stagePatch(project.stages[0]), { stageId: 's1', completed: false, completedAt: null });
  assert.deepEqual(completionPatch(project, true), { completed: true, stageId: 's3' });
  assert.equal(completionPatch(project, false).stageId, 's1');
});

test('stage automation assigns a member and WIP status reports limits', () => {
  const p = stageAutomationPatch(project.stages[1], { assignedUserIds: ['u1'], assignedToUid: 'u1' });
  assert.deepEqual(p.assignedUserIds, ['u1', 'u2']);
  assert.equal(p.assignedToUid, 'u1');
  assert.deepEqual(stageAutomationPatch(project.stages[0], { assignedToUid: 'u1' }), {});
  const tasks = [{ id: 'a', goalId: 'g', stageId: 's2' }, { id: 'b', goalId: 'g', stageId: 's1' }];
  assert.deepEqual(wipStatus(project.stages[1], project, tasks), { count: 1, limit: 1, exceeded: false, full: true });
  assert.equal(wipStatus(project.stages[1], project, [...tasks, { id: 'c', goalId: 'g', stageId: 's2' }]).exceeded, true);
  assert.equal(wipStatus(project.stages[0], project, tasks).limit, 0);
});

test('blockers ignores completed and missing tasks', () => {
  const tasks = [{ id: 'a', completed: true }, { id: 'b' }];
  assert.deepEqual(blockers({ blockedBy: ['a', 'b', 'x'] }, tasks).map(t => t.id), ['b']);
});

test('nextOccurrence handles daily/weekly/monthly and until', () => {
  assert.equal(nextOccurrence({ freq: 'daily', interval: 1 }, '2026-01-31'), '2026-02-01');
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 1 }, '2026-01-01'), '2026-01-08');
  assert.equal(nextOccurrence({ freq: 'biweekly' }, '2026-01-01'), '2026-01-15');
  assert.equal(nextOccurrence({ freq: 'monthly' }, '2026-01-31'), '2026-02-28');
  assert.equal(nextOccurrence({ freq: 'monthly', interval: 2 }, '2026-01-15'), '2026-03-15');
  assert.equal(nextOccurrence({ freq: 'daily', until: '2026-01-01' }, '2026-01-01'), null);
});

test('progress helpers', () => {
  assert.deepEqual(checklistProgress({ checklist: [{ done: true }, { done: false }] }), { done: 1, total: 2 });
  assert.equal(checklistProgress({}), null);
  assert.deepEqual(subtaskProgress([{ parentId: 'p', completed: true }, { parentId: 'p' }, { parentId: 'q' }], 'p'), { total: 2, done: 1 });
  const st = projectStats(project, [{ goalId: 'g', stageId: 's3', completed: true, plannedHours: 4, timesheets: [{ hours: 3 }] }, { goalId: 'g', stageId: 's1', dueDate: '2000-01-01' }, { goalId: 'g', parentId: 'x' }]);
  assert.equal(st.total, 2); assert.equal(st.done, 1); assert.equal(st.late, 1); assert.equal(st.pct, 50); assert.equal(st.spent, 3); assert.equal(st.milestonesDone, 1);
});

test('cloneFromTemplate remaps ids, shifts dates and resets completion', () => {
  const tpl = { id: 't', name: 'قالب', startDate: '2026-01-01', endDate: '2026-01-31', stages: project.stages, tags: [], milestones: [{ id: 'm', name: 'MVP', date: '2026-01-10', done: true }] };
  const tasks = [{ id: 'x', goalId: 't', name: 'أ', dueDate: '2026-01-05', completed: true, checklist: [{ id: 'c', text: 'ك', done: true }] }, { id: 'y', goalId: 't', name: 'ب', parentId: 'x', blockedBy: ['x'], startDate: '2026-01-06' }];
  const { goal, tasks: out } = cloneFromTemplate(tpl, tasks, { name: 'جديد', startDate: '2026-02-01', endDate: '2026-03-01' });
  assert.equal(goal.template, false);
  assert.equal(goal.milestones[0].done, false);
  assert.equal(out[0].dueDate, '2026-02-05');
  assert.equal(out[0].completed, false);
  assert.equal(out[0].checklist[0].done, false);
  assert.equal(out[1].parentId, out[0].id);
  assert.deepEqual(out[1].blockedBy, [out[0].id]);
  assert.equal(out[1].startDate, '2026-02-06');
});
