import { describe, expect, it } from 'vitest';
import { routeChatTask } from './chat-routing';

describe('chat task routing', () => {
  it.each([
    ['你好', 0, 'CHAT'],
    ['分析这个恒等式', 0, 'QUICK_ANALYSIS'],
    ['第 3 页的结论是什么？', 0, 'DOCUMENT_ANALYSIS'],
    ['查找相关文献', 0, 'LITERATURE_SEARCH'],
    ['继续自主研究', 0, 'DEEP_RESEARCH'],
    ['What does this say?', 1, 'DOCUMENT_ANALYSIS'],
  ] as const)('routes %s', (content, attachments, expected) => {
    expect(routeChatTask(content, attachments)).toBe(expected);
  });
});
