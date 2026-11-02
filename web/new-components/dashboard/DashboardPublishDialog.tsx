import { useUiText } from '@/hooks/use-ui-text';
import { getDashboardLiveShare, revokeDashboardLiveShare, type DashboardLiveShareStatus } from '@/client/api/dashboard';
import { CheckCircleFilled, CopyOutlined, FileImageOutlined, SyncOutlined } from '@ant-design/icons';
import { Alert, App, Button, Input, Modal, Popconfirm } from 'antd';
import { useEffect, useState } from 'react';
import styles from './DashboardPublishDialog.module.css';

export type DashboardPublishMode = 'live' | 'snapshot';
export interface DashboardPublishedLinks {
  mode: DashboardPublishMode;
  url: string;
  snapshotUrl: string;
  expiresAt?: string | null;
}

export default function DashboardPublishDialog({
  dashboardId,
  busy,
  onPublish,
  onClose,
}: {
  dashboardId: string;
  busy: boolean;
  onPublish: (mode: DashboardPublishMode) => Promise<DashboardPublishedLinks | undefined>;
  onClose: () => void;
}) {
  const tr = useUiText();
  const { message } = App.useApp();
  const [mode, setMode] = useState<DashboardPublishMode>('snapshot');
  const [status, setStatus] = useState<DashboardLiveShareStatus | null>(null);
  const [result, setResult] = useState<DashboardPublishedLinks | null>(null);
  const [revoking, setRevoking] = useState(false);
  const currentPath = mode === 'live' ? status?.share_path : status?.snapshot_share_path;
  const currentUrl =
    currentPath && typeof window !== 'undefined'
      ? `${status?.public_base_url || window.location.origin}${currentPath}`
      : '';
  const revoke = async () => {
    setRevoking(true);
    try {
      const response = await revokeDashboardLiveShare(dashboardId);
      if (!response.data.success) throw new Error(response.data.err_msg || tr('停用失败', 'Deactivation failed'));
      setStatus(previous => (previous ? { ...previous, active: false, share_path: null } : previous));
      message.success(tr('已停用持续更新链接', 'Live link deactivated'));
    } catch {
      message.error(tr('停用失败，请重试', 'Deactivation failed. Please try again.'));
    } finally {
      setRevoking(false);
    }
  };
  useEffect(() => {
    let active = true;
    void getDashboardLiveShare(dashboardId)
      .then(response => {
        if (active && response.data.success) setStatus(response.data.data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [dashboardId]);
  const publish = async () => {
    const links = await onPublish(mode);
    if (links) setResult(links);
  };
  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      message.success(tr('已复制分享链接', 'Share link copied'));
    } catch {
      message.info(tr('请选中下方链接复制', 'Select and copy the link below'));
    }
  };
  return (
    <Modal
      open
      title={result ? tr('发布完成', 'Published') : tr('发布看板', 'Publish dashboard')}
      width={620}
      onCancel={onClose}
      closable={!busy && !revoking}
      maskClosable={!busy && !revoking}
      keyboard={!busy && !revoking}
      footer={
        result ? (
          <Button type='primary' onClick={onClose}>
            {tr('完成', 'Done')}
          </Button>
        ) : (
          <>
            <Button disabled={busy || revoking} onClick={onClose}>
              {tr('取消', 'Cancel')}
            </Button>
            <Button type='primary' loading={busy} disabled={revoking} onClick={() => void publish()}>
              {mode === 'live' ? tr('发布并跟随更新', 'Publish with live updates') : tr('发布固定快照', 'Publish snapshot')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className={styles.result}>
          <CheckCircleFilled className={styles.success} />
          <h3>{result.mode === 'live' ? tr('数据会随数据源更新', 'Data updates with the source') : tr('已保留此刻的数据', 'Data has been preserved as a snapshot')}</h3>
          <p>
            {result.mode === 'live'
              ? tr('访客打开页面后，每分钟检查数据变化。布局和指标口径保持此次发布的版本。', 'When a visitor opens the page, data is checked every minute. Layout and metric definitions remain at this published version.')
              : tr('这个链接的数据保持不变，适合报告交付与历史对照。', 'Data at this link remains fixed for reporting and historical comparison.')}
          </p>
          <Input
            aria-label={tr('发布分享链接', 'Published share link')}
            value={result.url}
            readOnly
            onFocus={event => event.currentTarget.select()}
          />
          <div className={styles.actions}>
            <Button icon={<CopyOutlined />} onClick={() => void copy()}>
              {tr('复制链接', 'Copy link')}
            </Button>
            <Button type='primary' href={result.url} target='_blank' rel='noreferrer'>
              {tr('打开分享页', 'Open share page')}
            </Button>
          </div>
          {result.expiresAt && <small>{tr('有效至 ', 'Expires ')}{new Date(result.expiresAt).toLocaleString(tr('zh-CN', 'en-US'))}</small>}
          {result.mode === 'live' && (
            <a href={result.snapshotUrl} target='_blank' rel='noreferrer'>
              {tr('查看本次固定快照', 'View this snapshot')}
            </a>
          )}
        </div>
      ) : (
        <>
          <p className={styles.intro}>{tr('选择访客看到的数据如何更新。发布前会保存草稿并检查查询与筛选。', 'Choose how visitors see data updates. Publishing saves the draft and checks queries and filters.')}</p>
          <div className={styles.options} role='radiogroup' aria-label={tr('发布数据方式', 'Publishing mode')}>
            {(
              [
                {
                  id: 'live',
                  icon: <SyncOutlined />,
                  title: tr('跟随数据源更新', 'Update from data source'),
                  description: tr('适合日常看板。数据变化自动呈现，无需重复发布。', 'For operational dashboards. Data updates without republishing.'),
                  detail: tr('页面打开时，每分钟检查', 'Checked every minute while open'),
                },
                {
                  id: 'snapshot',
                  icon: <FileImageOutlined />,
                  title: tr('固定发布时的数据', 'Fix data at publication'),
                  description: tr('适合汇报与归档。保留本次发布的数值，方便核对。', 'For reports and archives. Preserve the published values.'),
                  detail: tr('固定快照，内容保持不变', 'Fixed snapshot; content does not change'),
                },
              ] as const
            ).map(option => (
              <button
                key={option.id}
                type='button'
                role='radio'
                aria-checked={mode === option.id}
                disabled={busy || revoking}
                onClick={() => setMode(option.id)}
                className={styles.option}
              >
                <span className={styles.icon}>{option.icon}</span>
                <strong>{option.title}</strong>
                <p>{option.description}</p>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
          {mode === 'live' && status?.active && (
            <Alert
              className='mt-4'
              type='warning'
              showIcon
              message={tr('重新发布持续更新会生成新链接，原持续更新链接将失效。', 'Republishing creates a new live link and deactivates the previous one.')}
            />
          )}
          {(currentUrl || (mode === 'live' && status?.active)) && (
            <div className={`${styles.actions} mt-4`}>
              {currentUrl && (
                <Button href={currentUrl} target='_blank' rel='noreferrer'>
                  {tr('打开当前分享', 'Open current share')}
                </Button>
              )}
              {mode === 'live' && status?.active && (
                <Popconfirm title={tr('停用后，原持续更新链接将无法访问。', 'The current live link will no longer be accessible.')} onConfirm={revoke}>
                  <Button danger loading={revoking} disabled={busy}>
                    {tr('停用持续更新', 'Deactivate live link')}
                  </Button>
                </Popconfirm>
              )}
            </div>
          )}
          <p className={styles.note}>{tr('分享页供访客只读查看。编辑草稿不会自动改变已发布的布局。', 'Visitors have read-only access. Editing the draft does not change the published layout.')}</p>
        </>
      )}
    </Modal>
  );
}
