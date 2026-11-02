import { useUiText } from '@/hooks/use-ui-text';
import {
  createDashboardFolder,
  deleteDashboardFolder,
  renameDashboardFolder,
  type DashboardFolder,
} from '@/client/api/dashboard';
import {
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  FolderOutlined,
  MoreOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Breadcrumb, Button, Dropdown, Empty, Input, Modal, Popconfirm, message } from 'antd';
import { useState } from 'react';
import styles from './DashboardFolderWorkspace.module.css';

export default function DashboardFolderWorkspace({
  folders,
  value,
  onChange,
  onRefresh,
  foldersOnly = false,
}: {
  foldersOnly?: boolean;
  folders: DashboardFolder[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  onRefresh: () => Promise<void>;
}) {
  const tr = useUiText();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const current = folders.find(f => f.id === value);
  const root = value === 'folders';
  const open = (id = '') => {
    setEditing(id);
    setName(folders.find(f => f.id === id)?.name || '');
  };
  const save = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const r = editing ? await renameDashboardFolder(editing, name) : await createDashboardFolder(name);
      if (!r.data.success) throw new Error(r.data.err_msg || tr('保存失败', 'Save failed'));
      await onRefresh();
      setEditing(null);
      if (!editing) onChange('folders');
    } catch (e) {
      message.error(e instanceof Error ? e.message : tr('保存失败', 'Save failed'));
    } finally {
      setBusy(false);
    }
  };
  const menu = (id: string) => ({
    items: [{ key: 'rename', label: tr('重命名', 'Rename'), icon: <EditOutlined /> }],
    onClick: () => open(id),
  });
  const matches = folders.filter(f => f.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <>
      <div className={styles.navigation} aria-label={tr('看板文件夹', 'Dashboard folders')}>
        {!foldersOnly && (
          <div className={styles.views}>
            <Button type={root || current ? 'primary' : 'text'} onClick={() => onChange('folders')}>
              {tr('所有文件夹', 'All folders')}
            </Button>
            <Button type={value === undefined ? 'primary' : 'text'} onClick={() => onChange(undefined)}>
              {tr('所有看板', 'All dashboards')}
            </Button>
            <Button type={value === 'unfiled' ? 'primary' : 'text'} onClick={() => onChange('unfiled')}>
              {tr('未分类', 'Uncategorized')}
            </Button>
          </div>
        )}
        {root ? (
          <Input
            className={styles.search}
            aria-label={tr('搜索文件夹', 'Search folders')}
            placeholder={tr('搜索文件夹', 'Search folders')}
            prefix={<SearchOutlined />}
            value={search}
            allowClear
            onChange={e => setSearch(e.target.value)}
          />
        ) : (
          <Button icon={<FolderAddOutlined />} onClick={() => open()}>
            {tr('新建文件夹', 'New folder')}
          </Button>
        )}
      </div>
      {root ? (
        <Dropdown
          trigger={['contextMenu']}
          menu={{ items: [{ key: 'new', label: tr('新建文件夹', 'New folder'), icon: <FolderAddOutlined /> }], onClick: () => open() }}
        >
          <div className={styles.grid} aria-label={tr('文件夹列表', 'Folders')}>
            <button
              type='button'
              aria-label={tr('新建文件夹', 'New folder')}
              className={`${styles.tile} ${styles.create}`}
              onClick={() => open()}
            >
              <FolderAddOutlined />
              <strong>{tr('新建文件夹', 'New folder')}</strong>
              <span>{tr('按项目或业务整理看板', 'Organize dashboards by project or business area')}</span>
            </button>
            {matches.map(folder => (
              <Dropdown key={folder.id} trigger={['contextMenu']} menu={menu(folder.id)}>
                <article className={styles.folder} onContextMenu={event => event.stopPropagation()}>
                  <button
                    type='button'
                    className={styles.tile}
                    aria-label={tr(`打开文件夹 ${folder.name}`, `Open folder ${folder.name}`)}
                    onClick={() => onChange(folder.id)}
                  >
                    <FolderOutlined />
                    <strong title={folder.name}>{folder.name}</strong>
                    <span>{tr(`${folder.count ?? 0} 个看板`, `${folder.count ?? 0} dashboards`)}</span>
                  </button>
                  <Dropdown trigger={['click']} menu={menu(folder.id)}>
                    <Button
                      className={styles.more}
                      type='text'
                      aria-label={tr(`${folder.name}文件夹操作`, `Actions for folder ${folder.name}`)}
                      icon={<MoreOutlined />}
                    />
                  </Dropdown>
                </article>
              </Dropdown>
            ))}
            {search && !matches.length && <Empty description={tr('没有匹配的文件夹', 'No matching folders')} />}
          </div>
        </Dropdown>
      ) : (
        current && (
          <div className={styles.breadcrumb}>
            <Breadcrumb
              items={[
                { title: <button onClick={() => onChange('folders')}>{tr('所有文件夹', 'All folders')}</button> },
                { title: current.name },
              ]}
            />
            <div className={styles.views}>
              <Button aria-label={tr('重命名文件夹', 'Rename folder')} icon={<EditOutlined />} onClick={() => open(current.id)} />
              <Popconfirm
                title={tr('删除文件夹？看板会回到未分类，不会删除看板。', 'Delete this folder? Its dashboards will become uncategorized and will not be deleted.')}
                onConfirm={async () => {
                  try {
                    const r = await deleteDashboardFolder(current.id);
                    if (!r.data.success) throw new Error(r.data.err_msg || tr('删除失败', 'Delete failed'));
                    await onRefresh();
                    onChange('folders');
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : tr('删除文件夹失败，请重试', 'Could not delete folder. Please try again.'));
                  }
                }}
              >
                <Button aria-label={tr('删除文件夹', 'Delete folder')} icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          </div>
        )
      )}
      <Modal
        title={editing ? tr('重命名文件夹', 'Rename folder') : tr('新建文件夹', 'New folder')}
        open={editing !== null}
        onCancel={() => {
          if (!busy) setEditing(null);
        }}
        onOk={() => void save()}
        confirmLoading={busy}
        okButtonProps={{ disabled: !name.trim() }}
      >
        <Input
          aria-label={tr('文件夹名称', 'Folder name')}
          placeholder={tr('例如：Apple 财务分析', 'For example: Financial analysis')}
          value={name}
          maxLength={80}
          onChange={e => setName(e.target.value)}
          onPressEnter={() => void save()}
        />
      </Modal>
    </>
  );
}
