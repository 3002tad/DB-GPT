import { useTranslation } from 'react-i18next';
import { getDashboardQueryLogic } from '@/client/api/dashboard';
import { DashboardFilter, DashboardQueryLogic, DashboardWidget } from '@/types/dashboard';
import { CopyOutlined } from '@ant-design/icons';
import { App, Button, Spin } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { format } from 'sql-formatter';
import { dashboardSourceLabel } from './dashboard-source-label';

export const widgetQueryParameters = (
  widget: DashboardWidget,
  filters: DashboardFilter[],
  values: Record<string, unknown>,
) => {
  const parameters = { ...widget.query.default_parameters };
  for (const [id, binding] of Object.entries(widget.query.filter_parameters)) {
    const filter = filters.find(item => item.id === id);
    const supplied = !!filter && Object.prototype.hasOwnProperty.call(values, id);
    const hasValue = supplied || (filter?.default !== undefined && filter.default !== null);
    const value = supplied ? values[id] : filter?.default;
    const optional = filter?.type === 'multi_select' ? [] : null;
    const bind = (name: string | null | undefined, boundValue: unknown, emptyValue: unknown = optional) => {
      if (!name) return;
      if (hasValue) parameters[name] = boundValue;
      else if (!Object.prototype.hasOwnProperty.call(parameters, name)) parameters[name] = emptyValue;
    };
    if (typeof binding === 'string') bind(binding, value);
    else {
      bind(binding.parameter, value);
      bind(binding.start_parameter, Array.isArray(value) ? (value[0] ?? null) : null, null);
      bind(binding.end_parameter, Array.isArray(value) ? (value[1] ?? null) : null, null);
    }
  }
  return parameters;
};

export default function DashboardQueryLogicPanel({
  dashboardId,
  widget,
  filters,
  values,
}: {
  dashboardId: string;
  widget: DashboardWidget;
  filters: DashboardFilter[];
  values: Record<string, unknown>;
}) {
  const { message } = App.useApp();
  const { i18n } = useTranslation();
  const tr = (zh: string, en: string, vi: string) =>
    i18n.language?.startsWith('vi') ? vi : i18n.language?.startsWith('en') ? en : zh;
  const sql = widget.query.sql || '';
  const source = widget.query.data_source_id;
  const key = JSON.stringify([dashboardId, source, sql]);
  const [result, setResult] = useState<{ key: string; logic?: DashboardQueryLogic; error?: string } | null>(null);
  const current = result?.key === key ? result : null;
  useEffect(() => {
    let active = true;
    if (!sql.trim()) return;
    const timer = setTimeout(async () => {
      try {
        const response = await getDashboardQueryLogic(dashboardId, sql, source);
        if (!response.data.success || !response.data.data) throw new Error('无法解析');
        if (active) setResult({ key, logic: response.data.data });
      } catch {
        if (active) setResult({ key, error: '暂时无法解析计算步骤，可直接查看下方原始 SQL。' });
      }
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [dashboardId, key, source, sql]);
  const formattedSql = useMemo(() => {
    try {
      return format(sql, { paramTypes: { named: [':'] } });
    } catch {
      return sql;
    }
  }, [sql]);
  const parameters = widgetQueryParameters(widget, filters, values);
  return (
    <div className='space-y-4 text-xs' data-testid='dashboard-query-logic'>
      <section className='space-y-3 rounded-lg border border-[var(--app-border)] p-3'>
        <h3 className='text-sm font-semibold'>{tr('计算口径', 'Calculation logic', 'Logic tính toán')}</h3>
        <p>
          <span className='text-[var(--app-muted)]'>{tr('数据源：', 'Data source: ', 'Nguồn dữ liệu: ')}</span>
          {dashboardSourceLabel(source, i18n.language)}
        </p>
        {!sql.trim() ? (
          <p className='text-[var(--app-muted)]'>{tr('尚未配置 SQL，可在高级数据设置中添加。', 'SQL is not configured. Add it in advanced data settings.', 'Chưa cấu hình SQL. Hãy thêm trong cài đặt dữ liệu nâng cao.')}</p>
        ) : !current ? (
          <Spin size='small' />
        ) : current.error ? (
          <p role='status'>{tr(current.error, 'Could not analyze calculation steps; the original SQL is shown below.', 'Không thể phân tích các bước tính toán; SQL gốc được hiển thị bên dưới.')}</p>
        ) : (
          current.logic && (
            <>
              <p className='break-words'>
                <span className='text-[var(--app-muted)]'>{tr('数据表：', 'Tables: ', 'Bảng dữ liệu: ')}</span>
                {current.logic.tables.join(', ') || tr('查询常量或派生结果', 'Constants or derived results', 'Hằng số hoặc kết quả dẫn xuất')}
              </p>
              {!!current.logic.set_operations.length && <p>{tr('合并方式：', 'Set operations: ', 'Phép hợp tập: ')}{current.logic.set_operations.join(' → ')}</p>}
              {current.logic.stages.map((stage, index) => (
                <details key={index} open={index === 0} className='space-y-2 border-t border-[var(--app-border)] pt-3'>
                  <summary className='cursor-pointer font-medium'>{stage.label}</summary>
                  <div>
                    <div className='mb-1 text-[var(--app-muted)]'>{tr('输出与计算表达式', 'Outputs and expressions', 'Đầu ra và biểu thức tính toán')}</div>
                    {stage.expressions.map((expression, i) => (
                      <code
                        key={i}
                        className='mb-1 block whitespace-pre-wrap break-words rounded bg-[var(--app-surface-muted)] p-2 leading-5'
                      >
                        {expression}
                      </code>
                    ))}
                  </div>
                  {!!stage.group_by.length && (
                    <p className='break-words'>
                      {tr('分组维度：', 'Grouping: ', 'Chiều nhóm: ')}<code>{stage.group_by.join(', ')}</code>
                    </p>
                  )}
                  {stage.where && (
                    <p className='break-words'>
                      {tr('数据筛选：', 'Row filter: ', 'Lọc dữ liệu: ')}<code>{stage.where}</code>
                    </p>
                  )}
                  {stage.having && (
                    <p className='break-words'>
                      {tr('汇总后筛选：', 'Aggregate filter: ', 'Lọc sau tổng hợp: ')}<code>{stage.having}</code>
                    </p>
                  )}
                  {!!stage.joins.length && (
                    <p className='break-words'>
                      {tr('关联条件：', 'Join conditions: ', 'Điều kiện liên kết: ')}<code>{stage.joins.join('; ')}</code>
                    </p>
                  )}
                  {stage.order_by && (
                    <p className='break-words'>
                      {tr('排序：', 'Sort: ', 'Sắp xếp: ')}<code>{stage.order_by}</code>
                    </p>
                  )}
                  {stage.limit && (
                    <p>
                      {tr('查询条数：', 'Row limit: ', 'Giới hạn dòng: ')}<code>{stage.limit}</code>
                    </p>
                  )}
                </details>
              ))}
              <p className='text-[var(--app-muted)]'>{tr('以上步骤来自当前 SQL；展开子查询可核对指标的完整计算过程。', 'These steps come from the current SQL; expand subqueries to inspect the full calculation.', 'Các bước lấy từ SQL hiện tại; mở rộng truy vấn con để kiểm tra toàn bộ phép tính.')}</p>
            </>
          )
        )}
      </section>
      <details className='rounded-lg border border-[var(--app-border)] p-3'>
        <summary className='cursor-pointer text-sm font-semibold'>{tr('实际 SQL', 'Actual SQL', 'SQL thực tế')}</summary>
        <div className='mb-2 flex items-center justify-between gap-2'>
          <Button
            size='small'
            icon={<CopyOutlined />}
            disabled={!sql.trim()}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(sql);
                message.success(tr('SQL 已复制', 'SQL copied', 'Đã sao chép SQL'));
              } catch {
                message.error(tr('复制失败，请选中 SQL 手动复制', 'Copy failed; select and copy the SQL manually', 'Sao chép thất bại; hãy chọn và sao chép SQL thủ công'));
              }
            }}
          >
            {tr('复制 SQL', 'Copy SQL', 'Sao chép SQL')}
          </Button>
        </div>
        <pre
          tabIndex={0}
          aria-label={tr('图表实际 SQL', 'Actual chart SQL', 'SQL thực tế của biểu đồ')}
          className='max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3 font-mono text-xs leading-5'
        >
          {formattedSql || tr('尚未配置 SQL', 'SQL not configured', 'Chưa cấu hình SQL')}
        </pre>
      </details>
      <details className='space-y-2 rounded-lg border border-[var(--app-border)] p-3'>
        <summary className='cursor-pointer text-sm font-semibold'>{tr('当前筛选参数', 'Current filter parameters', 'Tham số bộ lọc hiện tại')}</summary>
        {Object.keys(parameters).length ? (
          <dl className='space-y-1'>
            {Object.entries(parameters).map(([name, value]) => (
              <div
                key={name}
                className='flex flex-wrap justify-between gap-2 rounded bg-[var(--app-surface-muted)] px-3 py-2'
              >
                <dt className='break-all font-mono'>{name}</dt>
                <dd className='break-all'>
                  {value == null ? tr('未设置', 'Not set', 'Chưa đặt') : typeof value === 'string' ? value || tr('空字符串', 'Empty string', 'Chuỗi rỗng') : JSON.stringify(value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className='text-[var(--app-muted)]'>{tr('这条查询没有绑定筛选参数。', 'This query has no bound filter parameters.', 'Truy vấn này không có tham số bộ lọc được liên kết.')}</p>
        )}
        <p className='text-[var(--app-muted)]'>{tr(`当前查询最多返回 ${widget.query.max_rows} 行。`, `This query returns at most ${widget.query.max_rows} rows.`, `Truy vấn trả tối đa ${widget.query.max_rows} dòng.`)}</p>
      </details>
    </div>
  );
}
