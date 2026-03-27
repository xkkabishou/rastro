// pdf.js textLayer 选区修正 Hook
// 从 PdfViewer.tsx 中提取的选区偏移修正逻辑
// 解决 pdf.js textLayer 中 scaleX 变换导致的 hit-testing 偏移问题

/**
 * 修正 pdf.js textLayer 的选区起始点偏移
 *
 * pdf.js 的 textLayer 使用 CSS transform: scaleX() 来调整字符间距，
 * 但 scaleX 会导致 span 的 bounding box 溢出，使浏览器 hit-testing
 * 将 mousedown 映射到错误的 span。
 *
 * 策略：不修改 DOM 或 Range（通过 selectionchange 会导致拖选异常），
 * 而是在 mouseup 后一次性修正最终 Range：
 * - 如果 mousedown 坐标落在 startSpan 后面的 sibling span 中，
 *   将 range.start 修正到正确的 span
 *
 * 防护措施：
 * - 仅在正向选取（anchor 在 focus 之前）时修正
 * - mousedown 坐标与 startSpan 距离过远时跳过
 * - 只检查紧邻的下一个 span，避免跨行跳转
 */
export function fixTextLayerSelectionStart(
  sel: Selection,
  range: Range,
  mousedownX: number,
  mousedownY: number,
): void {
  if (mousedownX === 0 && mousedownY === 0) return;

  // 仅修正正向选取（anchor 在 focus 之前）
  if (sel.anchorNode && sel.focusNode) {
    const position = sel.anchorNode.compareDocumentPosition(sel.focusNode);
    const isBackward =
      (position & Node.DOCUMENT_POSITION_PRECEDING) !== 0 ||
      (sel.anchorNode === sel.focusNode && sel.anchorOffset > sel.focusOffset);
    if (isBackward) return;
  }

  const startNode = range.startContainer;
  const startSpan = (startNode.nodeType === Node.TEXT_NODE
    ? startNode.parentElement
    : startNode as HTMLElement
  )?.closest('.textLayer span') as HTMLElement | null;
  if (!startSpan) return;

  // 安全检查：mousedown 坐标应在 startSpan 附近
  const startRect = startSpan.getBoundingClientRect();
  if (mousedownX < startRect.left - 20 || mousedownX > startRect.right + startRect.width) return;
  if (mousedownY < startRect.top - 10 || mousedownY > startRect.bottom + 10) return;

  // 遍历 startSpan 之后的兄弟节点，查找包含 mousedown 的 span
  let sibling = startSpan.nextElementSibling;
  while (sibling) {
    if (sibling.tagName === 'SPAN' && sibling.closest('.textLayer')) {
      const sibRect = sibling.getBoundingClientRect();
      if (
        mousedownX >= sibRect.left &&
        mousedownX <= sibRect.right &&
        mousedownY >= sibRect.top - 2 &&
        mousedownY <= sibRect.bottom + 2
      ) {
        const textNode = sibling.firstChild;
        if (textNode) {
          range.setStart(textNode, 0);
        }
        return;
      }
      break; // 只检查紧邻的下一个 span
    }
    sibling = sibling.nextElementSibling;
  }
}

/**
 * 修正 pdf.js textLayer 的选区结束点偏移（与起始点修正对称）
 *
 * scaleX 变换同样会导致末尾 span 的 bounding box 向右溢出，
 * 使 mouseup 时 hit-testing 跳到下一个 span，选区结束点意外扩大。
 *
 * 策略：如果 mouseup 坐标在 endSpan 前一个 span 的范围内，
 * 将 range.end 收紧到前一个 span 的末尾。
 */
export function fixTextLayerSelectionEnd(
  sel: Selection,
  range: Range,
  mouseupX: number,
  mouseupY: number,
): void {
  if (mouseupX === 0 && mouseupY === 0) return;

  // 仅修正正向选取
  if (sel.anchorNode && sel.focusNode) {
    const position = sel.anchorNode.compareDocumentPosition(sel.focusNode);
    const isBackward =
      (position & Node.DOCUMENT_POSITION_PRECEDING) !== 0 ||
      (sel.anchorNode === sel.focusNode && sel.anchorOffset > sel.focusOffset);
    if (isBackward) return;
  }

  const endNode = range.endContainer;
  const endSpan = (endNode.nodeType === Node.TEXT_NODE
    ? endNode.parentElement
    : endNode as HTMLElement
  )?.closest('.textLayer span') as HTMLElement | null;
  if (!endSpan) return;

  // 安全检查：mouseup 坐标应在 endSpan 附近
  const endRect = endSpan.getBoundingClientRect();
  if (mouseupX < endRect.left - endRect.width || mouseupX > endRect.right + 20) return;
  if (mouseupY < endRect.top - 10 || mouseupY > endRect.bottom + 10) return;

  // 检查 mouseup 是否实际落在 endSpan 的前一个兄弟 span 中
  let sibling = endSpan.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === 'SPAN' && sibling.closest('.textLayer')) {
      const sibRect = sibling.getBoundingClientRect();
      if (
        mouseupX >= sibRect.left &&
        mouseupX <= sibRect.right &&
        mouseupY >= sibRect.top - 2 &&
        mouseupY <= sibRect.bottom + 2
      ) {
        const textNode = sibling.lastChild;
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          range.setEnd(textNode, (textNode as Text).length);
        }
        return;
      }
      break; // 只检查紧邻的前一个 span
    }
    sibling = sibling.previousElementSibling;
  }
}

/**
 * 选区合理性校验：如果鼠标拖动距离很短但选区文本异常大，
 * 说明 textLayer 的 scaleX 导致了 hit-testing 跳跃，应清除选区。
 *
 * 每像素拖动距离允许约 3 个字符（适配正常阅读速度的选取密度）。
 * 最低门槛：拖动距离 < 15px 时允许最多 60 字符（双击选词场景）。
 */
export function isSelectionReasonable(
  text: string,
  mousedownX: number,
  mousedownY: number,
  mouseupX: number,
  mouseupY: number,
): boolean {
  if (!text || mousedownX === 0) return true;
  const dx = mouseupX - mousedownX;
  const dy = mouseupY - mousedownY;
  const dragDistance = Math.sqrt(dx * dx + dy * dy);
  // 双击选词等场景拖动距离为 0 但选区文本很短，合理
  if (dragDistance < 15) return text.length <= 60;
  // 正常拖选：每像素允许约 3 个字符
  const maxCharsAllowed = Math.max(60, dragDistance * 3);
  return text.length <= maxCharsAllowed;
}
