# Cloud Functions (اختيارية)

تحتاج خطة **Blaze** في Firebase. بدونها يعمل التطبيق كاملاً، لكن بدون Push والتطبيق مغلق وبدون الملخص الأسبوعي المجدول (يوجد بديل من داخل التطبيق: الإعدادات ← الملخص الأسبوعي ← «أرسل الآن»/إرسال تلقائي عند فتح التطبيق).

```bash
npm i -g firebase-tools
firebase login
cd functions && npm install
firebase deploy --only functions
```

| الدالة | ماذا تفعل |
|---|---|
| `sendPush` | عند إنشاء مستند في `notifications` تُرسل Web Push لكل رموز FCM في `userProfiles/{uid}.fcmTokens` |
| `weeklyDigest` | كل سبت 8 صباحاً: بريد ملخص لكل من فعّل `weeklyDigest` في بروفايله (عبر إضافة Trigger Email) |
| `dailyReminders` | كل يوم 9 صباحاً: إشعار «مهامك اليوم» لكل عضو لديه مهام مستحقة أو متأخرة |

**مفتاح VAPID للإشعارات:** Firebase Console ← Project settings ← Cloud Messaging ← Web Push certificates ← Generate key pair، ثم ضعه في `js/data.js` في `FCM_VAPID_KEY`.
