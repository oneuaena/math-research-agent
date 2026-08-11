import type { ChatTaskRoute } from './types';

export function routeChatTask(content: string, attachmentCount = 0): ChatTaskRoute {
  const text = content.trim().toLowerCase();
  if (/\bdeep\s*research\b|\bresume\s+(?:the\s+)?research\b|\bcontinue\s+(?:the\s+)?research\b|\u6df1\u5ea6\u7814\u7a76|\u81ea\u4e3b\u7814\u7a76|\u7ee7\u7eed\u7814\u7a76|\u6062\u590d\u7814\u7a76/.test(text)) return 'DEEP_RESEARCH';
  if (/\bliterature\b|\bpapers?\b|\barxiv\b|\bprior\s+work\b|\u6587\u732e|\u8bba\u6587|\u524d\u4eba\u5de5\u4f5c|\u67e5\u65b0|\u76f8\u5173\u5de5\u4f5c/.test(text)) return 'LITERATURE_SEARCH';
  if (attachmentCount > 0 || /\b(?:pdf|docx|document|attachment|page\s*\d+)\b|\u6587\u6863|\u9644\u4ef6|\u7b2c\s*\d+\s*\u9875|\u8fd9\u7bc7|\u6839\u636e.*\u6587\u4ef6/.test(text)) return 'DOCUMENT_ANALYSIS';
  if (/\b(?:prove|proof|derive|calculate|compute|analy[sz]e|theorem|lemma|counterexample)\b|\u8bc1\u660e|\u53cd\u4f8b|\u8ba1\u7b97|\u5206\u6790|\u5b9a\u7406|\u5f15\u7406|\u63a8\u5bfc/.test(text)) return 'QUICK_ANALYSIS';
  return 'CHAT';
}
