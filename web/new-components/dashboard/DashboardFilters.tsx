import { DashboardFilter } from '@/types/dashboard';
import { useUiText } from '@/hooks/use-ui-text';
import { EditOutlined, UndoOutlined } from '@ant-design/icons';
import { Button, DatePicker, Input, InputNumber, Select, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useMemo } from 'react';
import styles from './DashboardWorkspace.module.css';

interface DashboardFiltersProps {
  filters: DashboardFilter[];
  values: Record<string, unknown>;
  disabled?: boolean;
  emptyOptionText?: string;
  scopeByFilter?: Record<string, string[]>;
  showReset?: boolean;
  variant?: 'bar' | 'card';
  className?: string;
  onEditFilter?: (filterId: string) => void;
  onChange?: (values: Record<string, unknown>, changedFilterId?: string) => void;
  onReset?: (values: Record<string, unknown>) => void;
}

export default function DashboardFilters({
  filters,
  values,
  disabled,
  emptyOptionText,
  scopeByFilter = {},
  showReset = true,
  variant = 'card',
  className = '',
  onEditFilter,
  onChange,
  onReset,
}: DashboardFiltersProps) {
  const tr = useUiText();
  // RangePicker resets pending input when its controlled value changes identity.
  // Unrelated editor updates must not discard a half-entered date range.
  const dateRanges = useMemo(() => {
    const result: Record<string, [Dayjs, Dayjs] | undefined> = {};
    for (const filter of filters) {
      if (filter.type !== 'date_range') continue;
      const value = values[filter.id] ?? filter.default;
      result[filter.id] =
        Array.isArray(value) && value.length === 2 ? [dayjs(String(value[0])), dayjs(String(value[1]))] : undefined;
    }
    return result;
  }, [filters, values]);
  if (!filters.length) return null;

  const update = (filterId: string, value: unknown) => onChange?.({ ...values, [filterId]: value }, filterId);
  const resetValues = {
    ...values,
    ...Object.fromEntries(filters.map(filter => [filter.id, filter.default])),
  };
  const isAtDefaults = filters.every(
    filter => JSON.stringify(values[filter.id] ?? filter.default) === JSON.stringify(filter.default),
  );

  return (
    <div
      className={`${styles.filters} ${variant === 'card' ? styles.filtersCard : styles.filtersBar} ${className}`.trim()}
    >
      {filters.map(filter => {
        const value = values[filter.id] ?? filter.default;
        const scope = scopeByFilter[filter.id] || [];
        return (
          <div key={filter.id} className={styles.filterItem} data-filter-type={filter.type}>
            <span className={styles.filterItemHeader}>
              <Tooltip title={scope.length ? tr(`${filter.label} · 影响：${scope.join('、')}`, `${filter.label} · Affects: ${scope.join(', ')}`) : filter.label}>
                <span className={styles.filterLabel}>{filter.label}</span>
              </Tooltip>
              <span className='flex min-w-0 items-center gap-1'>
                {variant !== 'bar' && Object.prototype.hasOwnProperty.call(scopeByFilter, filter.id) && (
                  <Tooltip title={scope.length ? tr(`影响：${scope.join('、')}`, `Affects: ${scope.join(', ')}`) : tr('尚未绑定任何组件', 'No widgets linked')}>
                    <span className={`${styles.filterScope} ${scope.length ? '' : '!text-[var(--app-warning)]'}`}>
                      {scope.length ? tr(`影响 ${scope.length} 个组件`, `Affects ${scope.length} widgets`) : tr('未绑定', 'Not linked')}
                    </span>
                  </Tooltip>
                )}
                {onEditFilter && (
                  <Button
                    type='link'
                    size='small'
                    aria-label={tr(`编辑${filter.label}筛选器`, `Edit ${filter.label} filter`)}
                    title={tr(`编辑${filter.label}筛选器`, `Edit ${filter.label} filter`)}
                    icon={variant === 'bar' ? <EditOutlined /> : undefined}
                    className={styles.editFilterButton}
                    onClick={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      onEditFilter(filter.id);
                    }}
                  >
                    {variant === 'bar' ? null : tr('编辑', 'Edit')}
                  </Button>
                )}
              </span>
            </span>
            <div className={styles.filterControl}>
              {filter.type === 'date_range' ? (
                <DatePicker.RangePicker
                  size='small'
                  aria-label={tr(`${filter.label}筛选`, `${filter.label} filter`)}
                  allowClear
                  disabled={disabled}
                  value={dateRanges[filter.id]}
                  onChange={dates =>
                    update(filter.id, dates ? [dates[0]?.format('YYYY-MM-DD'), dates[1]?.format('YYYY-MM-DD')] : null)
                  }
                />
              ) : filter.type === 'text' ? (
                <Input
                  size='small'
                  aria-label={tr(`${filter.label}筛选`, `${filter.label} filter`)}
                  allowClear
                  disabled={disabled}
                  value={typeof value === 'string' ? value : undefined}
                  placeholder={tr('输入关键词；清空表示全部', 'Enter a keyword; clear for all')}
                  onChange={event => update(filter.id, event.target.value || null)}
                />
              ) : filter.type === 'number_range' ? (
                <div className='flex items-center gap-2'>
                  <InputNumber
                    size='small'
                    aria-label={tr(`${filter.label}最小值`, `${filter.label} minimum`)}
                    disabled={disabled}
                    value={Array.isArray(value) && typeof value[0] === 'number' ? value[0] : null}
                    placeholder={tr('最小值', 'Minimum')}
                    onChange={next => update(filter.id, [next, Array.isArray(value) ? (value[1] ?? null) : null])}
                  />
                  <span>—</span>
                  <InputNumber
                    size='small'
                    aria-label={tr(`${filter.label}最大值`, `${filter.label} maximum`)}
                    disabled={disabled}
                    value={Array.isArray(value) && typeof value[1] === 'number' ? value[1] : null}
                    placeholder={tr('最大值', 'Maximum')}
                    onChange={next => update(filter.id, [Array.isArray(value) ? (value[0] ?? null) : null, next])}
                  />
                </div>
              ) : (
                <Select
                  size='small'
                  aria-label={tr(`${filter.label}筛选`, `${filter.label} filter`)}
                  allowClear
                  disabled={disabled}
                  showSearch
                  optionFilterProp='label'
                  maxTagCount='responsive'
                  mode={filter.type === 'multi_select' ? 'multiple' : undefined}
                  value={value as string | number | (string | number)[] | undefined}
                  placeholder={filter.type === 'multi_select' ? tr('可选择多个值；清空表示全部', 'Select multiple values; clear for all') : tr('请选择一个值', 'Select a value')}
                  notFoundContent={<span className='text-xs text-[var(--app-muted)]'>{emptyOptionText ?? tr('尚未配置可选值，请在编辑器右侧选择数据字段或手动输入选项', 'No options configured. Select a data field or add options in the editor.')}</span>}
                  options={filter.options.map(option => ({
                    label: option.label,
                    value: option.value as string | number,
                  }))}
                  onChange={next => update(filter.id, next)}
                />
              )}
            </div>
          </div>
        );
      })}
      {showReset && (
        <Button
          aria-label={tr('恢复默认筛选并刷新', 'Restore default filters and refresh')}
          className={styles.filterReset}
          disabled={disabled || isAtDefaults}
          icon={<UndoOutlined />}
          onClick={() => (onReset || onChange)?.(resetValues)}
        >
          {tr('恢复默认', 'Restore defaults')}
        </Button>
      )}
    </div>
  );
}
