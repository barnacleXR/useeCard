import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import '@vean/ui/styles.css';
import 'virtual:uno.css';
import './style.css';
import App from './App.vue';

declare module 'vue-router' { interface RouteMeta { title: string; subtitle: string } }
const routes = [
  {path: '/', component: () => import('./pages/SummaryPage.vue'), meta: {title: '备款汇总', subtitle: '知道哪天、哪个账户，需要准备多少钱。'}},
  {path: '/bills', component: () => import('./pages/BillsPage.vue'), meta: {title: '账单', subtitle: '金额和实际扣款日，以银行 App 为准。'}},
  {path: '/calendar', component: () => import('./pages/CalendarPage.vue'), meta: {title: '扣款日历', subtitle: '按日期查看已录入的还款安排。'}},
  {path: '/reports', component: () => import('./pages/ReportsPage.vue'), meta: {title: '月报', subtitle: '只统计实际扣款月份，不混合不同币种。'}},
  {path: '/reviews', component: () => import('./pages/ReviewsPage.vue'), meta: {title: '月度检查', subtitle: '没用的卡，不必逐张填零。'}},
  {path: '/manage', component: () => import('./pages/ManagePage.vue'), meta: {title: '卡片与账户', subtitle: '管理卡片、常用账户、默认还款币种与显示顺序。'}},
  {path: '/notifications', component: () => import('./pages/NotificationsPage.vue'), meta: {title: '通知', subtitle: '查看已录入账单的备款提醒与扣款日后待确认事项。'}},
  {path: '/audit', component: () => import('./pages/AuditPage.vue'), meta: {title: '操作记录', subtitle: '按操作与日本日期查询历史变更。'}},
  {path: '/settings', component: () => import('./pages/SettingsPage.vue'), meta: {title: '设置', subtitle: '管理你的自托管空间与个人偏好。'}},
  {path: '/profile', component: () => import('./pages/ProfilePage.vue'), meta: {title: '个人中心', subtitle: '资料、密码、单点登录与浏览器会话。'}},
  {path: '/backups', component: () => import('./pages/BackupPage.vue'), meta: {title: '备份管理', subtitle: '查看运行结果、下载或恢复完整备份。'}},
  {path: '/system', component: () => import('./pages/SystemPage.vue'), meta: {title: '系统状态', subtitle: '查看健康状态、后台任务和告警。'}},
  {path: '/oauth/consent', component: () => import('./pages/ConsentPage.vue'), meta: {title: '授权连接', subtitle: ''}},
  {path: '/:pathMatch(.*)*', redirect: '/'},
];
const router = createRouter({history: createWebHistory(), routes});
router.afterEach(to => { document.title = `${to.meta.title || 'useeCard'} · useeCard`; });
createApp(App).use(createPinia()).use(router).mount('#app');
if('serviceWorker' in navigator)window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js');});
