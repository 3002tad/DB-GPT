import { useUiText } from '@/hooks/use-ui-text';
import { DashboardRecord, DashboardSelectionTarget, DashboardTargetResolution } from '@/types/dashboard';
import { AimOutlined, DeleteOutlined, EditOutlined, SendOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Input, Spin } from 'antd';
import { Dispatch, SetStateAction, useRef, useState } from 'react';
import { DashboardAnnotationDraft, makeDashboardAnnotationDraft } from './dashboard-assistant';

interface DashboardAssistantPanelProps {
  record: DashboardRecord;
  drafts: DashboardAnnotationDraft[];
  available: boolean;
  onDraftsChange: Dispatch<SetStateAction<DashboardAnnotationDraft[]>>;
  onEditDraft?: (draft: DashboardAnnotationDraft) => void;
  onResolveReference: (reference: string) => Promise<DashboardTargetResolution>;
  onSubmit: (drafts: DashboardAnnotationDraft[], onStatus: (status: string) => void) => Promise<void>;
}

export default function DashboardAssistantPanel({
  record,
  drafts,
  available,
  onDraftsChange,
  onEditDraft,
  onResolveReference,
  onSubmit,
}: DashboardAssistantPanelProps) {
  const tr = useUiText();
  const [reference, setReference] = useState('');
  const [resolving, setResolving] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const busyRef = useRef(false);

  const resolveReference = async () => {
    const content = reference.trim();
    if (!content || busyRef.current || !available) return;
    busyRef.current = true;
    setResolving(true);
    setError('');
    setNotice('');
    try {
      const resolution = await onResolveReference(content);
      if (resolution.status === 'resolved' && resolution.target) {
        const target: DashboardSelectionTarget = resolution.target;
        onDraftsChange(current => [...current, { ...makeDashboardAnnotationDraft(target), content }]);
        setReference('');
        setNotice(tr('已加入待发送批注；发送时自动识别意图，修改会先返回预览提案。', 'Annotation added. Intent will be identified when sent; edits return a proposal for review.'));
      } else {
        setError(resolution.question || tr('请点选图表或说出完整标题，以确定批注对象。', 'Select a chart or provide its full title to identify the target.'));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr('无法解析目标，请点选图表', 'Could not resolve the target. Select a chart.'));
    } finally {
      busyRef.current = false;
      setResolving(false);
    }
  };

  const submit = async () => {
    const submitted = drafts.filter(item => item.content.trim());
    if (!submitted.length || busyRef.current || !available) return;
    busyRef.current = true;
    setRunning(true);
    setError('');
    setNotice('');
    setStatus(tr('正在识别批注意图…', 'Identifying annotation intent…'));
    try {
      await onSubmit(submitted, setStatus);
      onDraftsChange(current =>
        current.filter(item => !submitted.some(done => done.id === item.id && done.content === item.content)),
      );
      setNotice(tr('本批批注已交给 AI。修改会返回预览提案，解释与分析会返回说明。', 'Annotations sent to AI. Edits return a proposal; explanations and analyses return an answer.'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr('批注发送失败，请重试', 'Could not send annotations. Please retry.'));
    } finally {
      busyRef.current = false;
      setRunning(false);
      setStatus('');
    }
  };

  return (
    <div className='flex h-full min-h-0 flex-col' data-testid='dashboard-assistant-panel'>
      <div className='border-b border-[var(--app-border)] pb-3'>
        <div className='text-sm font-semibold text-[var(--app-text)]'>{tr('待发送批注', 'Pending annotations')}</div>
        <p className='mt-1 text-xs leading-5 text-[var(--app-muted)]'>
          {tr('在图表上添加批注，最后一起发送。直接描述要求，AI 会判断是修改、解释还是分析。', 'Add annotations to charts and send them together. Describe your request; AI will identify whether it is an edit, explanation or analysis.')}
        </p>
      </div>
      <div className='min-h-0 flex-1 space-y-3 overflow-y-auto py-3'>
        {drafts.map((item, index) => (
          <div
            key={item.id}
            className='rounded-lg border border-[var(--app-border)] p-3'
            data-testid='annotation-queue-item'
          >
            <div className='flex items-start gap-2'>
              <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--app-accent-soft)] text-xs font-semibold text-[var(--app-accent)]'>
                {index + 1}
              </span>
              <button
                type='button'
                disabled={running}
                className='min-w-0 flex-1 pt-0.5 text-left text-xs font-medium text-[var(--app-text)]'
                onClick={() => (onEditDraft ? onEditDraft(item) : setEditingId(item.id))}
              >
                {item.target.label}
              </button>
              <Button
                size='small'
                type='text'
                icon={<EditOutlined />}
                aria-label={tr('编辑 ' + item.target.label + ' 批注', 'Edit annotation for ' + item.target.label)}
                disabled={running}
                onClick={() => (onEditDraft ? onEditDraft(item) : setEditingId(editingId === item.id ? null : item.id))}
              />
              <Button
                size='small'
                type='text'
                danger
                icon={<DeleteOutlined />}
                aria-label={tr('删除 ' + item.target.label + ' 批注', 'Delete annotation for ' + item.target.label)}
                disabled={running}
                onClick={() => onDraftsChange(current => current.filter(draft => draft.id !== item.id))}
              />
            </div>
            {editingId === item.id ? (
              <Input.TextArea
                autoFocus
                autoSize={{ minRows: 3, maxRows: 8 }}
                aria-label={tr('编辑批注内容', 'Edit annotation')}
                value={item.content}
                disabled={running}
                onChange={event =>
                  onDraftsChange(current =>
                    current.map(draft => (draft.id === item.id ? { ...draft, content: event.target.value } : draft)),
                  )
                }
                onBlur={() => setEditingId(null)}
              />
            ) : (
              <p className='mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-[var(--app-muted)]'>
                {item.content || tr('尚未填写要求', 'No request entered')}
              </p>
            )}
          </div>
        ))}
        {!drafts.length && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tr('点击图表的批注按钮，添加第一条要求', 'Select the annotate button on a chart to add a request')} />
        )}
        {notice && (
          <p className='text-xs leading-5 text-[var(--app-muted)]' role='status'>
            {notice}
          </p>
        )}
        {running && (
          <div className='flex items-center gap-2 text-xs text-[var(--app-text)]' role='status' aria-live='polite'>
            <Spin size='small' />
            <span>{status}</span>
          </div>
        )}
        {!available && <Alert type='warning' showIcon message={tr('请在有编辑权限的看板中添加 AI 批注', 'Add AI annotations on a dashboard where you have edit access')} />}
        {error && (
          <Alert
            type='warning'
            showIcon
            message={tr('批注尚未发送', 'Annotations have not been sent')}
            description={<span className='whitespace-pre-wrap'>{error}</span>}
          />
        )}
      </div>
      <details className='mb-3 rounded-lg border border-[var(--app-border)] p-3' data-testid='natural-target-input'>
        <summary className='cursor-pointer text-xs text-[var(--app-muted)]'>{tr('也可以用文字指定图表', 'You can also describe a chart')}</summary>
        <Input.TextArea
          className='mt-3'
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder={tr('例如：右边的收入趋势图改成柱状图', 'For example: change the revenue trend chart on the right to a bar chart')}
          value={reference}
          disabled={!available || resolving || running}
          onChange={event => setReference(event.target.value)}
        />
        <Button
          className='mt-2'
          block
          icon={<AimOutlined />}
          loading={resolving}
          disabled={!available || !reference.trim() || running}
          onClick={resolveReference}
        >
          {tr('加入待发送批注', 'Add to pending annotations')}
        </Button>
      </details>
      <Button
        type='primary'
        icon={<SendOutlined />}
        loading={running}
        disabled={!available || resolving || !drafts.some(item => item.content.trim())}
        onClick={submit}
      >
        {tr(`发送给 AI（${drafts.filter(item => item.content.trim()).length} 条）`, `Send to AI (${drafts.filter(item => item.content.trim()).length})`)}
      </Button>
      <div className='mt-2 truncate text-xs text-[var(--app-muted)]' title={record.schema.dashboard.title}>
        {tr('当前看板：', 'Current dashboard: ')}{record.schema.dashboard.title}
      </div>
    </div>
  );
}
