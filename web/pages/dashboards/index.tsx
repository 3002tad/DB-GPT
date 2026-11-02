import { useTranslation } from 'react-i18next';
import { useUiText } from '@/hooks/use-ui-text';
import {
  archiveDashboard,
  copyDashboard,
  getDashboard,
  pageDashboards,
  refreshDashboard,
  restoreDashboard,
} from '@/client/api';
import { listDashboardFolders, moveDashboardToFolder, type DashboardFolder } from '@/client/api/dashboard';
import { AVAILABLE_CREATION_MODES, TEMPLATE_GALLERY_ENABLED } from '@/new-components/dashboard/dashboard-catalog';
import { describeDashboardError } from '@/new-components/dashboard/dashboard-errors';
import { dashboardSourceLabel } from '@/new-components/dashboard/dashboard-source-label';
import { readDashboardVisits, rememberDashboardVisit } from '@/new-components/dashboard/dashboard-visits';
import DashboardAssetCover from '@/new-components/dashboard/DashboardAssetCover';
import DashboardCoverCapture from '@/new-components/dashboard/DashboardCoverCapture';
import DashboardFolderBar from '@/new-components/dashboard/DashboardFolderWorkspace';
import styles from '@/new-components/dashboard/DashboardGallery.module.css';
import DashboardTemplateGallery from '@/new-components/dashboard/DashboardTemplateGallery';
import { DashboardListItem, DashboardRecord, DashboardSnapshot } from '@/types/dashboard';
import {
  CopyOutlined,
  HistoryOutlined,
  InboxOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ScheduleOutlined,
  SearchOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Dropdown, Empty, Input, Modal, Pagination, Select, Skeleton } from 'antd';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';

type LibraryTab = 'templates' | 'folders' | 'all' | 'recent' | 'tests' | 'archived';
const toItem = (r: DashboardRecord): DashboardListItem => ({
  id: r.id,
  title: r.schema.dashboard.title,
  description: r.schema.dashboard.description || '',
  data_source_id: r.schema.dashboard.data_source_id,
  conversation_id: r.conversation_id,
  origin: r.origin,
  asset_state: r.asset_state,
  current_revision: r.current_revision,
  status: r.status,
  updated_at: r.updated_at,
});
const formatTime = (value: string, locale: string) =>
  new Date(value).toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function DashboardListPage() {
  const tr = useUiText();
  const { i18n } = useTranslation();
const tabs: { key: LibraryTab; label: string }[] = [
  ...(TEMPLATE_GALLERY_ENABLED ? [{ key: 'templates' as const, label: tr('模板', 'Templates') }] : []),
  { key: 'folders', label: tr('所有文件夹', 'All folders') },
  { key: 'all', label: tr('全部看板', 'All dashboards') },
  { key: 'recent', label: tr('最近使用', 'Recent') },
];
  const router = useRouter();
  const { message } = App.useApp();
  const requestedTab = router.query.tab;
  const tab: LibraryTab =
    tabs.some(item => item.key === requestedTab) || requestedTab === 'tests' || requestedTab === 'archived'
      ? (requestedTab as LibraryTab)
      : router.query.view === 'manage' || !TEMPLATE_GALLERY_ENABLED
        ? 'all'
        : 'templates';
  const [folderId, setFolderId] = useState<string | undefined>(undefined);
  const [folders, setFolders] = useState<DashboardFolder[]>([]);
  const [movingItem, setMovingItem] = useState<DashboardListItem | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [moving, setMoving] = useState(false);
  const loadFolders = useCallback(async () => {
    const response = await listDashboardFolders();
    if (!response.data.success) throw new Error(response.data.err_msg || tr('文件夹加载失败', 'Failed to load folders'));
    setFolders(response.data.data);
  }, [tr]);
  useEffect(() => {
    // Initial page mount starts an external API read; state is set after it resolves.
    void loadFolders().catch(() => message.error(tr('文件夹加载失败，请刷新重试', 'Could not load folders. Refresh and try again.')));
  }, [loadFolders, message, tr]);
  const [items, setItems] = useState<DashboardListItem[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const pageSize = 12;
  const [coverQueue, setCoverQueue] = useState<DashboardListItem[]>([]);
  const [coverJob, setCoverJob] = useState<{ record: DashboardRecord; snapshot: DashboardSnapshot } | null>(null);
  const [coverRefresh, setCoverRefresh] = useState(0);
  const [coverErrors, setCoverErrors] = useState<Record<string, string>>({});
  const attemptedCovers = useRef(new Set<string>());
  const activeCoverId = useRef<string | null>(null);
  const enqueueCover = useCallback((item: DashboardListItem, force = false) => {
    const key = `${item.id}:${item.current_revision}`;
    if (!force && attemptedCovers.current.has(key)) return;
    attemptedCovers.current.add(key);
    setCoverErrors(current => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setCoverQueue(current => (current.some(queued => queued.id === item.id) ? current : [...current, item]));
  }, []);
  const finishCover = useCallback(
    (_image: string | null, error?: string) => {
      const id = activeCoverId.current;
      if (id && error) setCoverErrors(current => ({ ...current, [id]: error }));
      activeCoverId.current = null;
      setCoverJob(null);
      setCoverQueue(q => q.slice(1));
      setCoverRefresh(n => n + 1);
      if (error) message.warning(tr('此看板预览未更新：', 'Dashboard preview was not updated: ') + error);
    },
    [message, tr],
  );
  useEffect(() => {
    if (!coverQueue.length || coverJob) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        activeCoverId.current = coverQueue[0].id;
        const r = await getDashboard(coverQueue[0].id);
        if (!r.data.success) throw new Error(r.data.err_msg || tr('读取看板失败', 'Failed to load dashboard'));
        const snap = await refreshDashboard(r.data.data.id, {});
        if (!snap.data.success) throw new Error(snap.data.err_msg || tr('查询失败', 'Query failed'));
        if (
          !r.data.data.schema.widgets.length ||
          r.data.data.schema.widgets.some(
            w => !snap.data.data.widgets[w.id]?.rows.length || snap.data.data.widgets[w.id].error,
          )
        )
          throw new Error(tr('存在不可用组件，保留已有预览', 'Some widgets are unavailable; the existing preview was retained'));
        if (active) setCoverJob({ record: r.data.data, snapshot: snap.data.data });
      } catch (e) {
        if (active) finishCover(null, describeDashboardError(e, tr('无法生成预览', 'Could not generate preview')));
      }
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [coverQueue, coverJob, finishCover, tr]);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (tab === 'templates' || (tab === 'folders' && (!folderId || folderId === 'folders'))) {
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (tab === 'recent') {
        const visits = readDashboardVisits();
        const results = await Promise.allSettled(visits.map(visit => getDashboard(visit.id)));
        const available = results.flatMap(result =>
          result.status === 'fulfilled' && result.value.data.success ? [toItem(result.value.data.data)] : [],
        );
        const networkFailure = results.find(
          result => result.status === 'rejected' && ![403, 404].includes(result.reason?.response?.status),
        );
        if (networkFailure?.status === 'rejected') throw networkFailure.reason;
        const businessFailure = results.find(result => result.status === 'fulfilled' && !result.value.data.success);
        if (businessFailure?.status === 'fulfilled')
          throw new Error(businessFailure.value.data.err_msg || tr('最近看板加载失败', 'Failed to load recent dashboards'));
        const matches = available.filter(
          item =>
            item.status !== 'archived' &&
            `${item.title} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase()),
        );
        if (id === requestId.current) {
          setTotal(matches.length);
          setItems(matches.slice((page - 1) * pageSize, page * pageSize));
        }
      } else {
        const response = await pageDashboards({
          search: search || undefined,
          folder_id:
            tab === 'tests' ? '__tests__' : tab === 'all' || tab === 'folders' ? folderId || '__main__' : undefined,
          status: tab === 'archived' ? 'archived' : undefined,
          include_archived: tab === 'archived',
          exclude_origin: 'template',
          limit: pageSize,
          offset: (page - 1) * pageSize,
        });
        if (!response.data.success) throw new Error(response.data.err_msg || tr('加载看板失败', 'Failed to load dashboards'));
        if (id === requestId.current) {
          setItems(response.data.data.items);
          setTotal(response.data.data.total);
        }
      }
    } catch (reason) {
      if (id === requestId.current) setError(describeDashboardError(reason, tr('无法加载看板', 'Could not load dashboards')));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [tab, search, page, folderId, tr]);
  useEffect(() => {
    const cancellationVersion = requestId.current;
    const timer = setTimeout(() => void load(), 250);
    return () => {
      clearTimeout(timer);
      requestId.current = Math.max(requestId.current, cancellationVersion) + 1;
    };
  }, [load]);
  const open = (item: DashboardListItem, panel?: 'access' | 'lifecycle' | 'schedule') => {
    rememberDashboardVisit(item.id);
    void router.push({ pathname: '/dashboards/' + item.id, query: panel ? { panel } : undefined });
  };
  const action = async (key: string, item: DashboardListItem) => {
    try {
      if (key === 'copy') {
        const r = await copyDashboard(item.id);
        if (!r.data.success) throw new Error(r.data.err_msg || tr('复制失败', 'Copy failed'));
        await router.push('/dashboards/' + r.data.data.id);
        return;
      }
      const response =
        key === 'archive'
          ? await archiveDashboard(item.id, item.current_revision)
          : await restoreDashboard(item.id, item.current_revision);
      if (!response.data.success) throw new Error(response.data.err_msg || tr('操作失败', 'Operation failed'));
      await load();
    } catch (reason) {
      message.error(describeDashboardError(reason, tr('操作失败', 'Operation failed')));
    }
  };
  const menu = (item: DashboardListItem) => ({
    items: [
      {
        key: 'folder',
        label: tr('移动到文件夹', 'Move to folder'),
      },
      { key: 'copy', label: tr('复制为草稿', 'Copy as draft'), icon: <CopyOutlined /> },
      { key: 'lifecycle', label: tr('版本与分享', 'Versions and sharing'), icon: <HistoryOutlined /> },
      { key: 'access', label: tr('权限与审计', 'Access and audit'), icon: <SafetyCertificateOutlined /> },
      { key: 'schedule', label: tr('定时刷新', 'Scheduled refresh'), icon: <ScheduleOutlined /> },
      ...(item.conversation_id ? [{ key: 'task', label: tr('返回来源对话', 'Return to source conversation'), icon: <HistoryOutlined /> }] : []),
      { type: 'divider' as const },
      item.status === 'archived'
        ? { key: 'restore', label: tr('恢复看板', 'Restore dashboard'), icon: <UndoOutlined /> }
        : { key: 'archive', label: tr('归档看板', 'Archive dashboard'), icon: <InboxOutlined /> },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'folder') {
        setMoveTarget(folders.some(folder => folder.id === folderId) ? folderId! : '');
        setMovingItem(item);
      } else if (key === 'access' || key === 'lifecycle' || key === 'schedule') open(item, key);
      else if (key === 'task')
        void router.push({ pathname: '/', query: { conversation_id: item.conversation_id } });
      else void action(key, item);
    },
  });
  return (
    <div className={styles.page}>
      <Modal
        title={tr('移动到文件夹', 'Move to folder')}
        open={!!movingItem}
        onCancel={() => {
          if (!moving) setMovingItem(null);
        }}
        okText={tr('移动', 'Move')}
        confirmLoading={moving}
        onOk={async () => {
          if (!movingItem || moving) return;
          setMoving(true);
          try {
            const r = await moveDashboardToFolder(movingItem.id, moveTarget || null);
            if (!r.data.success) throw new Error(r.data.err_msg || tr('移动失败', 'Move failed'));
            await loadFolders();
            await load();
            setMovingItem(null);
          } catch (reason) {
            message.error(describeDashboardError(reason, tr('移动失败，请重试', 'Move failed. Please try again.')));
          } finally {
            setMoving(false);
          }
        }}
      >
        <p className='mb-3 break-words'>{movingItem?.title}</p>
        <Select
          aria-label={tr('目标文件夹', 'Destination folder')}
          className='w-full'
          showSearch
          optionFilterProp='label'
          value={moveTarget}
          onChange={setMoveTarget}
          options={[
            { value: '', label: tr('未分类', 'Uncategorized') },
            ...folders.map(folder => ({ value: folder.id, label: folder.name })),
          ]}
        />
      </Modal>
      {coverJob && (
        <DashboardCoverCapture
          key={coverJob.record.id}
          record={coverJob.record}
          snapshot={coverJob.snapshot}
          onComplete={finishCover}
        />
      )}
      <Head>
        <title>{tr('数据看板 · DB-GPT', 'Dashboards · DB-GPT')}</title>
      </Head>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <h1>{tr('数据看板', 'Dashboards')}</h1>
            <p>
              {TEMPLATE_GALLERY_ENABLED ? tr('选一个模板开始，或继续编辑已有看板。', 'Choose a template to get started, or continue editing a dashboard.') : tr('找到你的看板，继续分析与编辑。', 'Find your dashboards and continue analyzing and editing.')}
            </p>
          </div>
          {AVAILABLE_CREATION_MODES.some(mode => mode.id === 'dashboard') && (
            <Button type='primary' icon={<PlusOutlined />} onClick={() => router.push('/dashboards/new')}>
              {tr('创建看板', 'Create dashboard')}
            </Button>
          )}
        </header>
        <nav className={styles.tabs} aria-label={tr('看板分类', 'Dashboard categories')}>
          {tabs.map(item => (
            <button
              type='button'
              key={item.key}
              aria-pressed={tab === item.key || (item.key === 'all' && (tab === 'tests' || tab === 'archived'))}
              onClick={() => {
                setPage(1);
                setSearch('');
                setFolderId(undefined);
                setItems([]);
                setTotal(0);
                setError('');
                void router.replace({ pathname: '/dashboards', query: { tab: item.key } }, undefined, {
                  shallow: true,
                });
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {tab === 'templates' ? (
          <DashboardTemplateGallery />
        ) : (
          <>
            {(tab === 'all' || tab === 'tests' || tab === 'archived') && (
              <nav className={styles.categories} aria-label={tr('全部看板分类', 'All dashboard categories')} style={{ marginBottom: 20 }}>
                {[
                  { key: 'all', label: tr('所有看板', 'All dashboards') },
                  { key: 'tests', label: tr('验收测试', 'Acceptance tests') },
                  { key: 'archived', label: tr('已归档', 'Archived') },
                ].map(item => (
                  <button
                    key={item.key}
                    type='button'
                    aria-pressed={tab === item.key}
                    onClick={() => {
                      setPage(1);
                      setItems([]);
                      setFolderId(undefined);
                      void router.replace({ pathname: '/dashboards', query: { tab: item.key } }, undefined, {
                        shallow: true,
                      });
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            )}
            {tab === 'folders' && (
              <DashboardFolderBar
                folders={folders}
                value={folderId || 'folders'}
                foldersOnly
                onChange={id => {
                  setFolderId(id);
                  setPage(1);
                }}
                onRefresh={loadFolders}
              />
            )}
            {!(tab === 'folders' && (!folderId || folderId === 'folders')) && (
              <>
                <div className={styles.tools}>
                  <Input
                    className={styles.search}
                    prefix={<SearchOutlined />}
                    placeholder={tr('搜索看板', 'Search dashboards')}
                    aria-label={tr('搜索看板', 'Search dashboards')}
                    allowClear
                    value={search}
                    onChange={event => {
                      setPage(1);
                      setSearch(event.target.value);
                    }}
                  />
                  <span className='flex-1 text-xs text-[var(--app-muted)]'>
                    {tab === 'recent'
                      ? tr('本浏览器最近打开的看板', 'Dashboards recently opened in this browser')
                      : tab === 'tests'
                        ? tr('验收看板集中展示，原始记录与版本均保留', 'Acceptance dashboards, with original records and versions preserved')
                        : tr('按最近更新排序', 'Sorted by most recently updated')}
                  </span>
                  <Button
                    disabled={!items.length || !!coverQueue.length}
                    loading={!!coverQueue.length}
                    onClick={() => items.forEach(item => enqueueCover(item, true))}
                  >
                    {coverQueue.length ? tr(`正在生成（剩余 ${coverQueue.length}）`, `Generating (${coverQueue.length} remaining)`) : tr('更新本页预览', 'Update previews on this page')}
                  </Button>
                  <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
                    {tr('刷新', 'Refresh')}
                  </Button>
                </div>
                {error && (
                  <Alert
                    className='mb-5'
                    type='error'
                    showIcon
                    message={error}
                    description={
                      items.length
                        ? tr('已保留上次加载的内容。恢复连接后可重试。', 'Previously loaded content was retained. Retry when the connection is restored.')
                        : tr('暂时无法读取看板，请检查服务连接后重试。', 'Could not load dashboards. Check the connection and try again.')
                    }
                    action={
                      <Button onClick={() => void load()} loading={loading}>
                        {tr('重试', 'Retry')}
                      </Button>
                    }
                  />
                )}
                {loading && !items.length ? (
                  <div className={styles.grid}>
                    {Array.from({ length: 8 }, (_, i) => (
                      <Skeleton.Node active key={i} className='!w-full !h-48' />
                    ))}
                  </div>
                ) : items.length ? (
                  <div className={styles.grid}>
                    {items.map(item => (
                      <article key={item.id} className={styles.card}>
                        <button
                          type='button'
                          className={styles.cover}
                          aria-label={tr(`打开看板 ${item.title}`, `Open dashboard ${item.title}`)}
                          onClick={() => open(item)}
                        >
                          <DashboardAssetCover
                            item={item}
                            refreshKey={coverRefresh}
                            onNeedsPreview={enqueueCover}
                            generating={coverQueue.some(queued => queued.id === item.id)}
                            failure={coverErrors[item.id]}
                          />
                          <span className={styles.coverAction}>{tr('打开看板', 'Open dashboard')}</span>
                        </button>
                        {coverErrors[item.id] && (
                          <Button size='small' onClick={() => enqueueCover(item, true)}>
                            {tr('重试预览', 'Retry preview')}
                          </Button>
                        )}
                        <div className={styles.cardTitle}>
                          <button className='flex-1' onClick={() => open(item)} title={item.title}>
                            {item.title}
                          </button>
                          <Dropdown trigger={['click']} menu={menu(item)}>
                            <Button
                              size='small'
                              type='text'
                              aria-label={tr(item.title + '更多操作', `More actions for ${item.title}`)}
                              icon={<MoreOutlined />}
                            />
                          </Dropdown>
                        </div>
                        <p className={styles.description}>{item.description || tr('暂无看板说明', 'No dashboard description')}</p>
                        <div className={styles.meta}>
                          <span title={item.data_source_id}>{dashboardSourceLabel(item.data_source_id, i18n.language)}</span>
                          <span>{formatTime(item.updated_at, tr('zh-CN', 'en-US'))}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  !error && (
                    <Empty
                      className={styles.empty}
                      description={
                        search
                          ? tr('没有找到匹配的看板', 'No matching dashboards')
                          : tab === 'recent'
                            ? tr('打开一个看板后，会在这里留下记录', 'Dashboards you open will appear here')
                            : tab === 'archived'
                              ? tr('暂无归档看板', 'No archived dashboards')
                              : tr('还没有已保存的看板', 'No saved dashboards yet')
                      }
                    />
                  )
                )}
                {total > pageSize && (
                  <div className={styles.pagination}>
                    <Pagination
                      current={page}
                      total={total}
                      pageSize={pageSize}
                      onChange={setPage}
                      showSizeChanger={false}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
