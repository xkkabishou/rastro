# Tooltip → 右键菜单平滑过渡

## 问题

鼠标悬停 Zotero 文献条目时出现标题翻译 Tooltip，右键后 Tooltip 瞬间消失，右键菜单无动画地出现。

## 根因

1. `ItemFolder.onContextMenu` 调用 `handleItemMouseLeave()` 同步清空 tooltip state
2. `ContextMenuPortal` 没有入场动画

## 方案：序列动画（方案 A）

1. 右键时仅设 `visible: false`（保留其余 state），让 AnimatePresence 退出动画播放
2. 延迟 ~120ms 后再触发 `onContextMenu`（让 Tooltip 退出完成）
3. `ContextMenuPortal` 增加 framer-motion 入场动画（淡入 + 微缩放）

## 改动文件

- `ZoteroList.tsx`：修改 `ItemFolder` 的 `onContextMenu` 处理器
- `DocumentContextMenu.tsx`：为 `ContextMenuPortal` 添加入场动画
