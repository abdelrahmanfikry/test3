// ملف تجميع: كل الشاشات في js/views/ — الاستيراد من './views.js' يبقى كما هو.
export { filters, applyGanttChange, stageMovePatch, parseQuick, bindTaskList, taskList, exportCSV } from './views/shared.js';
export { renderDashboard } from './views/dashboard.js';
export { renderGoals, createFromTemplate } from './views/goals.js';
export { renderTasks } from './views/tasks.js';
export { renderCalendar } from './views/calendar.js';
export { renderReports } from './views/reports.js';
export { renderTeam, openMember } from './views/team.js';
export { renderActivity } from './views/activity.js';
export { renderSettings } from './views/settings.js';
export { openGoalModal, openTaskModal, openAccessModal, openGoalDrawer, refreshDrawer, closeDrawer, drawerOpenGoal } from './views/modals.js';
