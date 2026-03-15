// NotebookLM 当前不再采用 WebView / DOM 注入方案。
// 本文件仅保留真实集成模式会使用到的常量与展示文案。

/** NotebookLM 首页地址 */
export const NOTEBOOKLM_URL = 'https://notebooklm.google.com/';

/** 仍保留外部浏览器兜底入口。 */
export const NOTEBOOKLM_UNAVAILABLE_MESSAGE =
  '首次连接会优先拉起系统默认浏览器完成 Google 登录；若自动拉起失败，仍可用“外部打开”作为兜底入口。';

/** 目前 UI 中真正打通的产物类型。 */
export const NOTEBOOKLM_MVP_ARTIFACT = 'mind-map' as const;
