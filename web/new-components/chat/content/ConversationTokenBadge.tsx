import { useTranslation } from 'react-i18next';
import { useConversationTokens } from '@/hooks/use-conversation-meters';

export default function ConversationTokenBadge({ conversationId, running, ready = true }: { conversationId: string | null; running: boolean; ready?: boolean }) {
  const usage = useConversationTokens(conversationId, running, ready);
  const { i18n } = useTranslation();
  const vi = i18n.language?.startsWith('vi');
  const zh = i18n.language?.startsWith('zh');
  if (!conversationId) return null;
  const number = usage.total === null ? null : usage.total.toLocaleString(vi ? 'vi-VN' : zh ? 'zh-CN' : 'en-US');
  const incomplete = vi ? 'Chưa đầy đủ' : zh ? '不完整' : 'Incomplete';
  const label = vi ? 'Đã dùng' : zh ? '已使用' : 'Used';
  return <span role='status' className='rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-500 dark:border-white/10 dark:text-slate-300'
    title={vi
      ? 'Usage provider tích lũy của phiên qua các model, tách biệt với dung lượng ngữ cảnh. Không phải quota còn lại. Các đường chưa ghi nhận usage không được tính là 0.'
      : zh ? '会话跨模型累计的提供商用量，与上下文容量和剩余额度无关；缺失用量不记为零。'
      : 'Accumulated provider usage across models in this conversation, separate from context capacity and remaining quota. Missing usage is not zero.'}>
    {label}: {number === null ? `— · ${incomplete}` : `${number} token${usage.complete && !usage.failed ? '' : ` · ${incomplete}`}`}
  </span>;
}
