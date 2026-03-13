// NotebookLM 当前不再采用 WebView / DOM 注入方案。
// 本文件仅保留真实集成模式会使用到的常量与展示文案。

/** NotebookLM 首页地址 */
export const NOTEBOOKLM_URL = 'https://notebooklm.google.com/';

/** 仍保留外部浏览器兜底入口。 */
export const NOTEBOOKLM_UNAVAILABLE_MESSAGE =
  '若本地 NotebookLM 服务未完成认证或运行依赖缺失，可先在外部浏览器打开 NotebookLM 作为兜底入口。';

/** 目前 UI 中真正打通的产物类型。 */
export const NOTEBOOKLM_MVP_ARTIFACT = 'mind-map' as const;
