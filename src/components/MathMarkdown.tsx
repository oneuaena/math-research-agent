import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

export function MathMarkdown({ content, display = false }: { content: string; display?: boolean }) {
  return <div className={`math-markdown ${display ? 'display-math' : ''}`}>
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {display && !content.includes('$') ? `$$${content}$$` : content}
    </ReactMarkdown>
  </div>;
}
