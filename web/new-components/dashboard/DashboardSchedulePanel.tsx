import { useUiText } from '@/hooks/use-ui-text';
import {
  createDashboardSchedule,
  deleteDashboardSchedule,
  getDashboardSchedulerStatus,
  listDashboardScheduleRuns,
  listDashboardSchedules,
  runDashboardSchedule,
  toggleDashboardSchedule,
  updateDashboardSchedule,
} from '@/client/api';
import { type DashboardSchedulerStatus } from '@/client/api/dashboard';
import type {
  DashboardFilter,
  DashboardSchedule,
  DashboardScheduleCreate,
  DashboardScheduleRun,
  DashboardScheduleRunStatus,
} from '@/types/dashboard';
import {
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { isAxiosError } from 'axios';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { describeDashboardError } from './dashboard-errors';
import { scheduleDashboardFilterValues } from './dashboard-relative-date';
import DashboardRefreshFrequencyInput, { describeDashboardScheduleCron } from './DashboardRefreshFrequencyInput';

const { Text } = Typography;

type ScheduleForm = {
  task_name: string;
  description?: string;
  publish_after_refresh: boolean;
  timeout_seconds: number;
  max_attempts: number;
};

interface DashboardSchedulePanelProps {
  children?: ReactNode;
  dashboardId: string;
  filters: Record<string, unknown>;
  filterDefinitions: DashboardFilter[];
  open: boolean;
  onClose: () => void;
}

const statusColors: Record<DashboardScheduleRunStatus, string> = {
  running: 'processing',
  success: 'success',
  partial_success: 'warning',
  failed: 'error',
  timeout: 'error',
};

export default function DashboardSchedulePanel({
  children,
  dashboardId,
  filters,
  filterDefinitions,
  open,
  onClose,
}: DashboardSchedulePanelProps) {
  const tr = useUiText();
const statusLabels: Record<DashboardScheduleRunStatus, string> = useMemo(() => ({
  running: tr('运行中', 'Running'),
  success: tr('成功', 'Success'),
  partial_success: tr('部分成功', 'Partial success'),
  failed: tr('失败', 'Failed'),
  timeout: tr('超时', 'Timed out'),
}), [tr]);

  const { message, modal } = App.useApp();
  const [form] = Form.useForm<ScheduleForm>();
  const [cron, setCron] = useState('*/5 * * * *');
  const [schedules, setSchedules] = useState<DashboardSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [editing, setEditing] = useState<DashboardSchedule | null>(null);
  const [runs, setRuns] = useState<DashboardScheduleRun[]>([]);
  const [runsFor, setRunsFor] = useState<DashboardSchedule | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [scheduler, setScheduler] = useState<DashboardSchedulerStatus | null>(null);
  const [latestRuns, setLatestRuns] = useState<Record<string, DashboardScheduleRun[]>>({});

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const [response, runtime] = await Promise.all([
        listDashboardSchedules(dashboardId),
        getDashboardSchedulerStatus(dashboardId),
      ]);
      if (!runtime.data.success) throw new Error(tr('后台状态读取失败', 'Could not read scheduler status'));
      setScheduler(runtime.data.data);
      setSchedules(response.data.data || []);
      const history = await Promise.all(
        (response.data.data || []).map(async schedule => {
          try {
            const r = await listDashboardScheduleRuns(dashboardId, schedule.task_id, 20);
            return [schedule.task_id, r.data.data || []] as const;
          } catch {
            return [schedule.task_id, []] as const;
          }
        }),
      );
      setLatestRuns(Object.fromEntries(history));
    } catch (error) {
      setScheduler(null);
      message.error(describeDashboardError(error, tr('读取刷新计划失败', 'Could not load refresh schedules')));
    } finally {
      setLoading(false);
    }
  }, [dashboardId, message, tr]);

  useEffect(() => {
    // Opening the drawer is the external event that starts the remote refresh.
    if (open) void loadSchedules();
  }, [loadSchedules, open]);

  const resetEditor = () => {
    setEditing(null);
    setCron('*/5 * * * *');
    form.setFieldsValue({
      task_name: '',
      description: '',
      publish_after_refresh: false,
      timeout_seconds: 180,
      max_attempts: 2,
    });
  };

  const editSchedule = (schedule: DashboardSchedule) => {
    setEditing(schedule);
    setCron(schedule.cron_expression);
    form.setFieldsValue({
      task_name: schedule.task_name,
      description: schedule.description || '',
      publish_after_refresh: schedule.payload.publish_after_refresh,
      timeout_seconds: schedule.payload.timeout_seconds,
      max_attempts: schedule.payload.max_attempts,
    });
  };

  const saveSchedule = async () => {
    let values: ScheduleForm;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (cron.trim().split(/\s+/).length !== 5) {
      message.error(tr('Cron 表达式必须包含 5 段', 'Cron expressions must have 5 fields'));
      return;
    }

    const request: DashboardScheduleCreate = {
      ...values,
      cron_expression: cron,
      filters: scheduleDashboardFilterValues(filterDefinitions, filters),
    };
    setSaving(true);
    try {
      if (editing) {
        await updateDashboardSchedule(dashboardId, editing.task_id, request);
        message.success(tr('刷新计划已更新', 'Refresh schedule updated'));
      } else {
        await createDashboardSchedule(dashboardId, request);
        message.success(tr('刷新计划已创建', 'Refresh schedule created'));
      }
      resetEditor();
      await loadSchedules();
    } catch (error) {
      message.error(describeDashboardError(error, editing ? tr('更新刷新计划失败', 'Could not update refresh schedule') : tr('创建刷新计划失败', 'Could not create refresh schedule')));
    } finally {
      setSaving(false);
    }
  };

  const toggleSchedule = async (schedule: DashboardSchedule, enabled: boolean) => {
    try {
      const response = await toggleDashboardSchedule(dashboardId, schedule.task_id, enabled);
      setSchedules(current => current.map(item => (item.task_id === schedule.task_id ? response.data.data : item)));
      message.success(enabled ? tr('刷新计划已启用', 'Refresh schedule enabled') : tr('刷新计划已暂停', 'Refresh schedule paused'));
    } catch (error) {
      message.error(describeDashboardError(error, tr('切换刷新计划失败', 'Could not change refresh schedule')));
    }
  };

  const runNow = async (schedule: DashboardSchedule) => {
    setRunningId(schedule.task_id);
    try {
      const response = await runDashboardSchedule(dashboardId, schedule.task_id, schedule.payload);
      const run = response.data.data;
      if (run.status === 'partial_success') {
        message.warning(tr('刷新已完成，但部分组件失败，请查看运行记录', 'Refresh completed with failed widgets; review the run history'));
      } else if (run.status === 'success') {
        message.success(tr('刷新已完成', 'Refresh completed'));
      } else if (run.status === 'running') {
        message.info(tr('任务仍在执行，请查看运行记录', 'The task is still running; review the run history'));
      } else {
        message.error(run.error_message || tr('任务执行未成功，请查看运行记录', 'The task did not succeed; review the run history'));
      }
      if (runsFor?.task_id === schedule.task_id) await showRuns(schedule);
    } catch (error) {
      if (isAxiosError(error) && ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code || '')) {
        message.warning(tr('等待响应超时，任务可能仍在执行，请查看运行记录', 'Timed out waiting; the task may still be running. Review the run history.'));
        await showRuns(schedule);
      } else {
        message.error(describeDashboardError(error, tr('立即刷新失败', 'Refresh failed')));
      }
    } finally {
      setRunningId(null);
    }
  };

  const removeSchedule = (schedule: DashboardSchedule) => {
    modal.confirm({
      title: tr('删除刷新计划？', 'Delete refresh schedule?'),
      content: tr(`计划“${schedule.task_name}”将停止执行，已有运行记录一并停止展示。`, `Schedule “${schedule.task_name}” will stop and its run history will no longer be displayed.`),
      okText: tr('删除', 'Delete'),
      okButtonProps: { danger: true },
      cancelText: tr('取消', 'Cancel'),
      onOk: async () => {
        try {
          await deleteDashboardSchedule(dashboardId, schedule.task_id);
          if (runsFor?.task_id === schedule.task_id) {
            setRunsFor(null);
            setRuns([]);
          }
          await loadSchedules();
          message.success(tr('刷新计划已删除', 'Refresh schedule deleted'));
        } catch (error) {
          message.error(describeDashboardError(error, tr('删除刷新计划失败', 'Could not delete refresh schedule')));
        }
      },
    });
  };

  const showRuns = async (schedule: DashboardSchedule) => {
    setRunsFor(schedule);
    setLoadingRuns(true);
    try {
      const response = await listDashboardScheduleRuns(dashboardId, schedule.task_id);
      setRuns(response.data.data || []);
    } catch (error) {
      message.error(describeDashboardError(error, tr('读取运行记录失败', 'Could not load run history')));
    } finally {
      setLoadingRuns(false);
    }
  };

  const runColumns = useMemo(
    () => [
      {
        title: tr('状态', 'Status'),
        dataIndex: 'status',
        width: 110,
        render: (status: DashboardScheduleRunStatus) => <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>,
      },
      { title: tr('开始时间', 'Started at'), dataIndex: 'started_at', width: 180, render: (value?: string) => value || '-' },
      { title: tr('尝试次数', 'Attempts'), dataIndex: 'attempt_count', width: 90 },
      {
        title: tr('结果', 'Result'),
        render: (_: unknown, run: DashboardScheduleRun) => (
          <div>
            <div>{run.result_summary || '-'}</div>
            {run.error_message && <Text type='danger'>{run.error_message}</Text>}
            {run.output_resource_id && (
              <a className='ml-2' href={run.output_resource_id} target='_blank' rel='noreferrer'>
                {tr('打开发布快照', 'Open published snapshot')}
              </a>
            )}
          </div>
        ),
      },
    ],
    [tr, statusLabels],
  );

  return (
    <Drawer title={tr('定时刷新与运行记录', 'Scheduled refresh and run history')} width={760} open={open} onClose={onClose} destroyOnClose={false}>
      {children}
      <Alert
        className='mb-3'
        showIcon
        type={scheduler?.running ? 'success' : 'warning'}
        message={scheduler?.message || tr('后台运行状态尚未确认，请重新加载。', 'Scheduler status is unknown. Reload and try again.')}
      />
      <Alert
        className='mb-4'
        type='info'
        showIcon
        message={tr('计划使用当前筛选条件刷新看板；只有全部组件成功时才允许自动发布。', 'Schedules refresh the dashboard with current filters. Automatic publication requires all widgets to succeed.')}
      />

      <div className='mb-5 rounded border border-gray-200 p-4 dark:border-gray-700'>
        <div className='mb-3 flex items-center justify-between'>
          <Text strong>{editing ? tr('编辑刷新计划', 'Edit refresh schedule') : tr('新建刷新计划', 'New refresh schedule')}</Text>
          {editing && <Button onClick={resetEditor}>{tr('取消编辑', 'Cancel editing')}</Button>}
        </div>
        <Form
          form={form}
          layout='vertical'
          initialValues={{ publish_after_refresh: false, timeout_seconds: 180, max_attempts: 2 }}
        >
          <Form.Item name='task_name' label={tr('计划名称', 'Schedule name')} rules={[{ required: true, message: tr('请输入计划名称', 'Enter a schedule name') }]}>
            <Input maxLength={256} placeholder={tr('例如：每天早上刷新经营看板', 'For example: refresh the dashboard every morning')} />
          </Form.Item>
          <Form.Item name='description' label={tr('说明', 'Description')}>
            <Input.TextArea maxLength={2000} rows={2} />
          </Form.Item>
          <Form.Item label={tr('执行频率', 'Frequency')} required>
            <DashboardRefreshFrequencyInput value={cron} onChange={setCron} />
          </Form.Item>
          <Space size='large' align='start' wrap>
            <Form.Item name='publish_after_refresh' label={tr('成功后发布', 'Publish on success')} valuePropName='checked'>
              <Switch />
            </Form.Item>
            <Form.Item name='timeout_seconds' label={tr('单次超时（秒）', 'Timeout per attempt (seconds)')}>
              <InputNumber min={5} max={600} />
            </Form.Item>
            <Form.Item name='max_attempts' label={tr('最多尝试次数', 'Maximum attempts')}>
              <InputNumber min={1} max={5} />
            </Form.Item>
          </Space>
          <div>
            <Button
              type='primary'
              icon={editing ? <EditOutlined /> : <PlusOutlined />}
              loading={saving}
              onClick={saveSchedule}
            >
              {editing ? tr('保存修改', 'Save changes') : tr('创建计划', 'Create schedule')}
            </Button>
          </div>
        </Form>
      </div>

      <div className='mb-3 flex items-center justify-between'>
        <Text strong>{tr('已有计划', 'Existing schedules')}</Text>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={loadSchedules}>
          {tr('重新加载', 'Reload')}
        </Button>
      </div>
      <Spin spinning={loading}>
        {schedules.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tr('还没有刷新计划', 'No refresh schedules')} />
        ) : (
          <div className='space-y-3'>
            {schedules.map(schedule => (
              <div key={schedule.task_id} className='rounded border border-gray-200 p-3 dark:border-gray-700'>
                <div className='flex items-start gap-3'>
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-2'>
                      <Text strong>{schedule.task_name}</Text>
                      <Tag color={schedule.enabled && scheduler?.running ? 'green' : 'default'}>
                        {!schedule.enabled ? tr('已暂停', 'Paused') : scheduler?.running ? tr('运行中', 'Running') : tr('等待后台启动', 'Waiting for scheduler')}
                      </Tag>
                    </div>
                    <Descriptions size='small' column={2} className='mt-2'>
                      <Descriptions.Item label={tr('执行频率', 'Frequency')}>
                        <div>{describeDashboardScheduleCron(schedule.cron_expression)}</div>
                        <Text type='secondary' className='text-xs'>
                          {schedule.cron_expression}
                        </Text>
                      </Descriptions.Item>
                      <Descriptions.Item label={tr('下次执行', 'Next run')}>
                        {!schedule.enabled
                          ? tr('已暂停', 'Paused')
                          : !scheduler?.running
                            ? tr('后台未运行', 'Scheduler is not running')
                            : schedule.next_run_time || tr('等待调度器计算', 'Waiting for scheduler')}
                      </Descriptions.Item>
                      <Descriptions.Item label={tr('失败重试', 'Retry attempts')}>{tr(`${schedule.payload.max_attempts} 次`, `${schedule.payload.max_attempts} attempts`)}</Descriptions.Item>
                      <Descriptions.Item label={tr('自动发布', 'Automatic publication')}>
                        {schedule.payload.publish_after_refresh ? tr('是', 'Yes') : tr('否', 'No')}
                      </Descriptions.Item>
                      <Descriptions.Item label={tr('最近执行', 'Latest run')}>
                        {latestRuns[schedule.task_id]?.[0]
                          ? statusLabels[latestRuns[schedule.task_id][0].status]
                          : tr('暂无记录', 'No runs')}
                      </Descriptions.Item>
                      <Descriptions.Item label={tr('上次成功', 'Last success')}>
                        {latestRuns[schedule.task_id]?.find(run => run.status === 'success')?.finished_at ||
                          tr('最近 20 次内暂无成功记录', 'No successful runs among the latest 20')}
                      </Descriptions.Item>
                    </Descriptions>
                  </div>
                  <Switch checked={schedule.enabled} onChange={enabled => toggleSchedule(schedule, enabled)} />
                </div>
                <Space className='mt-2' wrap>
                  <Button
                    icon={<PlayCircleOutlined />}
                    loading={runningId === schedule.task_id}
                    onClick={() => runNow(schedule)}
                  >
                    {tr('立即运行', 'Run now')}
                  </Button>
                  <Button icon={<HistoryOutlined />} onClick={() => showRuns(schedule)}>
                    {tr('运行记录', 'Run history')}
                  </Button>
                  <Button icon={<EditOutlined />} onClick={() => editSchedule(schedule)}>
                    {tr('编辑', 'Edit')}
                  </Button>
                  <Button danger icon={<DeleteOutlined />} onClick={() => removeSchedule(schedule)}>
                    {tr('删除', 'Delete')}
                  </Button>
                </Space>
              </div>
            ))}
          </div>
        )}
      </Spin>

      {runsFor && (
        <div className='mt-6'>
          <div className='mb-2 flex items-center justify-between'>
            <Text strong>{tr(`“${runsFor.task_name}”的运行记录`, `Run history for “${runsFor.task_name}”`)}</Text>
            <Button size='small' loading={loadingRuns} onClick={() => showRuns(runsFor)}>
              {tr('刷新记录', 'Refresh history')}
            </Button>
          </div>
          <Table<DashboardScheduleRun>
            rowKey='run_id'
            size='small'
            loading={loadingRuns}
            columns={runColumns}
            dataSource={runs}
            pagination={{ pageSize: 8 }}
          />
        </div>
      )}
    </Drawer>
  );
}
