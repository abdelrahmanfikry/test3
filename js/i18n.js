// لغة الواجهة: عربي (افتراضي) أو إنجليزي. الترجمة تعمل بقاموس نصوص يُطبَّق على الهيكل الثابت وعلى كل شاشة بعد رسمها.
// ملاحظة: القاموس يغطي القوائم والعناوين والأزرار الرئيسية؛ النصوص التفصيلية التي ليست فيه تبقى بالعربية.
import { state } from './store.js';

const DICT = {
  'لوحة التحكم': 'Dashboard', 'المشاريع': 'Projects', 'المهام': 'Tasks', 'التقويم': 'Calendar', 'التقارير': 'Reports', 'الأنشطة': 'Activities', 'سجل النشاط': 'Activity log', 'الفريق': 'Team', 'الإعدادات': 'Settings', 'سلة المحذوفات': 'Trash', 'المشروع': 'Project', 'الرئيسية': 'Home', 'المزيد': 'More', 'المفضلة': 'Favorites', '★ المفضلة': '★ Favorites',
  'سجل أهدافي': 'My Goals', 'بحث': 'Search', 'هدف': 'Goal', 'مهمة': 'Task', 'مهمة جديدة': 'New task', 'هدف جديد': 'New goal', 'مشروع جديد': 'New project', 'مهمة سريعة': 'Quick task', 'إضافة': 'Add', 'إلغاء': 'Cancel', 'حفظ': 'Save', 'حذف': 'Delete', 'تعديل': 'Edit', 'تأكيد': 'Confirm', 'إغلاق': 'Close', 'خروج': 'Exit', 'رائع': 'Great', 'تسجيل الخروج': 'Sign out', 'دخول': 'Sign in',
  'مرحباً بعودتك': 'Welcome back', 'ادخل إلى أهدافك وخطتك اليومية': 'Access your goals and daily plan', 'البريد الإلكتروني': 'Email', 'كلمة المرور': 'Password', 'اسمك': 'Your name', 'إنشاء حساب جديد': 'Create an account', 'لديك حساب؟ دخول': 'Have an account? Sign in', 'نسيت كلمة المرور؟': 'Forgot password?', 'المتابعة عبر Google': 'Continue with Google', 'تحب تجرّب قبل التسجيل؟': 'Want to try first?', 'افتح النسخة التجريبية': 'Open the demo', 'حساب جديد': 'New account', 'استعادة كلمة المرور': 'Reset password', 'إنشاء الحساب': 'Create account', 'إرسال رابط الاستعادة': 'Send reset link',
  'خطة واضحة. خطوات صغيرة. نتائج كبيرة.': 'Clear plan. Small steps. Big results.',
  'مهام اليوم': 'Due today', 'متأخرة': 'Overdue', 'أُنجزت هذا الأسبوع': 'Done this week', 'سلسلة الإنجاز': 'Streak', 'الأهداف المكتملة': 'Completed goals', 'نسبة الإنجاز': 'Completion', 'ركّز اليوم': 'Focus today', 'كل المهام →': 'All tasks →', 'أهداف قريبة من موعدها': 'Goals due soon', 'كل الأهداف →': 'All goals →', 'أنشطة مستحقة': 'Activities due', 'كل الأنشطة →': 'All activities →', 'مهامي المكلّف بها': 'Assigned to me', 'الأيام السبعة القادمة': 'Next 7 days', 'التقويم →': 'Calendar →', 'إنجازك خلال 12 أسبوعاً': 'Your last 12 weeks', 'التقارير →': 'Reports →', 'عبء العمل على الفريق': 'Team workload', 'الفريق →': 'Team →', 'اليوم': 'Today', 'غداً': 'Tomorrow', 'هذا الأسبوع': 'This week', 'لاحقاً': 'Later', 'بدون موعد': 'No date', 'منجزة': 'Done', 'مفتوحة': 'Open', 'الكل': 'All',
  'قائمة': 'List', 'كانبان': 'Kanban', 'مهامي': 'My tasks', 'جانت': 'Gantt', 'كل الأهداف': 'All goals', 'كل المكلّفين': 'All assignees', 'كل الأولويات': 'All priorities', 'كل التاجز': 'All tags', 'تجميع: الموعد': 'Group: due', 'تجميع: المشروع': 'Group: project', 'تجميع: المرحلة': 'Group: stage', 'تجميع: الأولوية': 'Group: priority', 'بدون تجميع': 'No grouping', 'عالية': 'High', 'متوسطة': 'Medium', 'منخفضة': 'Low', 'نشط': 'Active', 'مكتمل': 'Completed', 'مؤرشف': 'Archived',
  'نظرة عامة': 'Overview', 'المعالم': 'Milestones', 'المراحل': 'Stages', 'التاجز': 'Tags', 'عام': 'General', 'أدوات': 'Tools', 'المتابعون / الأعضاء': 'Followers / members', 'التفاصيل': 'Details', 'قائمة المراجعة': 'Checklist', 'مهام فرعية': 'Subtasks', 'الساعات': 'Hours', 'مرفقات': 'Attachments', 'المحادثة والسجل': 'Chatter', 'الأولوية': 'Priority', 'الساعات المخططة': 'Planned hours', 'تاريخ البداية': 'Start date', 'الموعد النهائي': 'Deadline', 'المكلّفون': 'Assignees', 'الوصف': 'Description', 'التكرار': 'Recurrence', 'بدون تكرار': 'No recurrence',
  'الحساب': 'Account', 'التفضيلات': 'Preferences', 'المظهر': 'Theme', 'اللون الرئيسي': 'Accent color', 'حجم الخط': 'Font size', 'بداية الأسبوع': 'Week starts on', 'الصفحة الافتتاحية': 'Home page', 'اختصارات لوحة المفاتيح': 'Keyboard shortcuts', 'البيانات': 'Data', 'عن التطبيق': 'About', 'اسم العرض': 'Display name', 'اللغة': 'Language', 'الإشعارات': 'Notifications', 'المساعد الذكي': 'AI assistant', 'قوالب المهام': 'Task templates', 'ما الجديد': "What's new", 'تحديث التطبيق': 'Update app', 'تصدير CSV': 'Export CSV', 'نسخة احتياطية JSON': 'JSON backup', 'استيراد JSON': 'Import JSON', 'تصدير للتقويم (.ics)': 'Export calendar (.ics)',
  'الإنجاز خلال 8 أسابيع': 'Completion over 8 weeks', 'تقدّم الأهداف': 'Goals progress', 'حسب المكلّف': 'By assignee', 'حسب التصنيف': 'By category', 'حسب المشروع': 'By project', 'الساعات المسجّلة خلال 30 يوماً': 'Hours logged (30 days)', 'التكلفة': 'Cost', 'جدول محوري': 'Pivot', 'إجمالي المهام': 'Total tasks', 'متوسط أسبوعي': 'Weekly average', 'طباعة': 'Print',
  'العضو': 'Member', 'الدور': 'Role', 'مشرف': 'Admin', 'مستخدم': 'User', 'آخر ظهور': 'Last seen', 'دعوة عضو': 'Invite member', 'سعر الساعة': 'Hourly rate', 'الطاقة الأسبوعية': 'Weekly capacity', 'ساعات الأسبوع': 'Hours this week',
  'وضع تجريبي — البيانات على هذا الجهاز فقط': 'Demo mode — data stays on this device', 'أنت غير متصل بالإنترنت — يمكنك المتابعة وستُزامَن التغييرات عند عودة الاتصال': 'You are offline — keep working, changes sync when you reconnect', 'وضع التركيز': 'Focus mode', 'تركيز': 'Focus', 'استراحة': 'Break', 'ابدأ': 'Start', 'إعادة': 'Reset', 'خطة اليوم': "Today's plan", 'مساعد التخطيط': 'Planning assistant',
};

export function lang() { return state.prefs.lang === 'en' ? 'en' : 'ar'; }
export function t(s) { return lang() === 'en' && DICT[s] ? DICT[s] : s; }

/** يترجم عقد النص داخل عنصر (ويعيد تطبيق العربية عند العودة عبر data-ar) */
export function translateTree(root) {
  if (!root) return;
  const en = lang() === 'en';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const raw = n.nodeValue; const key = raw.trim(); if (!key) continue;
    if (en) { const tr = DICT[key]; if (tr) { if (!n._ar) n._ar = raw; n.nodeValue = raw.replace(key, tr); } }
    else if (n._ar) { n.nodeValue = n._ar; n._ar = null; }
  }
  root.querySelectorAll('[placeholder], [title], [aria-label]').forEach(el => {
    for (const a of ['placeholder', 'title', 'aria-label']) {
      const v = el.getAttribute(a); if (!v) continue;
      if (en) { const tr = DICT[v.trim()]; if (tr) { el.setAttribute('data-ar-' + a, v); el.setAttribute(a, tr); } }
      else if (el.hasAttribute('data-ar-' + a)) { el.setAttribute(a, el.getAttribute('data-ar-' + a)); el.removeAttribute('data-ar-' + a); }
    }
  });
}

/** يطبّق اللغة على الاتجاه والهيكل الثابت */
export function applyLang() {
  const en = lang() === 'en';
  document.documentElement.lang = en ? 'en' : 'ar';
  document.documentElement.dir = en ? 'ltr' : 'rtl';
  ['authScreen', 'sidebar', 'demoBar', 'offlineBar'].forEach(id => translateTree(document.getElementById(id)));
  document.querySelectorAll('.bottom-nav, .topbar, .modal-bg, .chat').forEach(translateTree);
}
