import { useUiText } from '@/hooks/use-ui-text';
import {
  adaptDashboardTemplate,
  generateDashboardTemplate,
  getDashboardTemplateFeatures,
  inspectTemplateSource,
  previewDashboardTemplate,
  type DashboardTemplateFeatures,
  type TemplatePreview,
  type TemplateSourceField,
  type TemplateSourceInfo,
  type TemplateSourceJoin,
  type TemplateSourceMapping,
} from '@/client/api/dashboard';
import { SELECTED_MODEL_STORAGE_KEY } from '@/lib/model-runtime';
import {
  CheckCircleOutlined,
  CommentOutlined,
  DeleteOutlined,
  PlusOutlined,
  SlidersOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Alert, Button, Checkbox, Collapse, Input, Modal, Radio, Select, Spin, Steps, Tag } from 'antd';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import type { CatalogTemplate } from './dashboard-catalog';
import { describeDashboardError } from './dashboard-errors';
import { dashboardSourceLabel } from './dashboard-source-label';
import DashboardRenderer from './DashboardRenderer';
import styles from './DashboardTemplateSetup.module.css';
import { templateEnglish } from './dashboard-gallery-locales';

const emptyMapping = (): TemplateSourceMapping => ({
  table: '',
  fields: {},
  joins: [],
  date_format: 'iso',
  unit: '',
  interval: 'month',
  grain: 'order',
});
const fieldValue = (field?: TemplateSourceField) => (field ? JSON.stringify(field) : undefined);

export default function DashboardTemplateSetup({
  template,
  sources,
  onClose,
}: {
  template: CatalogTemplate;
  sources: string[];
  onClose: () => void;
}) {
  const tr = useUiText();
const grainLabels = {
  store_week: tr('一间门店的一周记录', 'One store-week'),
  order: tr('一笔订单', 'One order'),
  order_line: tr('一笔商品订单明细', 'One order line'),
  payment: tr('一笔支付记录', 'One payment'),
  incident: tr('一条去重后的工单', 'One deduplicated incident'),
  measurement: tr('一次独立采样 / 测量', 'One observation or measurement'),
  student: tr('一名学生的一门课程记录', 'One student course record'),
  product: tr('一项商品的当前库存快照', 'One current product inventory snapshot'),
};
  const router = useRouter();
  const [source, setSource] = useState(template.sourceNames.find(name => sources.includes(name)) || sources[0] || '');
  const [info, setInfo] = useState<TemplateSourceInfo | null>(null);
  const [manual, setManual] = useState(false);
  const [aiAssisted, setAiAssisted] = useState(true);
  const [features, setFeatures] = useState<DashboardTemplateFeatures | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  useEffect(() => {
    let active = true;
    void getDashboardTemplateFeatures(template.id)
      .then(response => {
        if (active && response.data.success) {
          setFeatures(response.data.data);
          setAiPrompt(response.data.data.prompt);
        }
      })
      .catch(() => {
        if (active)
          setAiPrompt(
            `参考「${template.title}」的布局与样式，使用所选数据源创建看板。${template.description} 字段不匹配时根据真实数据自适应调整。`,
          );
      });
    return () => {
      active = false;
    };
  }, [template.id, template.title, template.description]);
  const [mapping, setMapping] = useState<TemplateSourceMapping>(emptyMapping);
  const [confirmedGrain, setConfirmedGrain] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const epoch = useRef(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setInfo(null);
      setPreview(null);
      setError('');
      setMapping(emptyMapping());
      setConfirmedGrain(false);
      if (!source) {
        setLoading(false);
        return;
      }
      try {
        const r = await inspectTemplateSource(template.id, source);
        if (!r.data.success) throw new Error(r.data.err_msg || tr('无法读取数据表', 'Could not read tables'));
        if (active) {
          setInfo(r.data.data);
          setManual(!r.data.data.builtin_available);
          setMapping({
            ...emptyMapping(),
            grain: r.data.data.grain,
            table: r.data.data.tables.length === 1 ? r.data.data.tables[0].name : '',
          });
        }
      } catch (e) {
        if (active) setError(describeDashboardError(e, tr('数据源不可用', 'Data source unavailable')));
      } finally {
        if (active) setLoading(false);
      }
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [source, template.id, tr]);
  const editMapping = (patch: Partial<TemplateSourceMapping>) => {
    epoch.current++;
    setPreview(null);
    setError('');
    setMapping(value => ({ ...value, ...patch }));
  };
  const availableTables = [mapping.table, ...mapping.joins.map(j => j.table)].filter(Boolean);
  const fieldOptions = (tables = availableTables) =>
    (info?.tables || [])
      .filter(t => tables.includes(t.name))
      .map(t => ({
        label: t.name,
        options: t.columns.map(c => ({
          label: `${t.name}.${c.name} · ${c.type}`,
          value: fieldValue({ table: t.name, column: c.name })!,
        })),
      }));
  const requiredRoles = info?.roles.filter(r => r.required) || [];
  const missingRoles = requiredRoles.filter(r => !mapping.fields[r.id]);
  const fieldsComplete = !!info && missingRoles.length === 0;
  const joinsComplete = mapping.joins.every(j => j.table && j.left.table && j.left.column && j.right_column);
  const mappingNextStep = !mapping.table
    ? tr('请先选择业务明细表，下面的字段选择才会开放。', 'Select a detail table to choose fields.')
    : missingRoles.length
      ? tr(`还需匹配：${missingRoles.map(r => r.label).join('、')}。`, `Still required: ${missingRoles.map(r => r.label).join(', ')}.`)
      : !joinsComplete
        ? tr('请补全关联表的连接字段，或移除不需要的关联。', 'Complete the join fields or remove unnecessary joins.')
        : !mapping.unit.trim()
          ? tr('请填写主要数值的单位。', 'Enter the unit of the primary value.')
          : !confirmedGrain
            ? tr('请确认明细表每行代表的业务含义和数值单位。', 'Confirm the meaning of each detail row and the value unit.')
            : tr('匹配已填写完整，可以验证查询并预览。', 'Mapping is complete. Validate the query and preview.');
  const canPreview =
    !!source &&
    !!info &&
    (aiAssisted ||
      !manual ||
      (mapping.table && mapping.unit.trim() && confirmedGrain && fieldsComplete && joinsComplete));
  const check = async () => {
    const version = ++epoch.current;
    setBusy(true);
    setError('');
    try {
      const response = aiAssisted
        ? await adaptDashboardTemplate(
            template.id,
            source,
            aiPrompt,
            localStorage.getItem(SELECTED_MODEL_STORAGE_KEY) || undefined,
          )
        : await previewDashboardTemplate(template.id, source, manual ? mapping : undefined);
      if (!response.data.success) throw new Error(response.data.err_msg || tr('预览验证失败', 'Preview validation failed'));
      if (epoch.current === version) setPreview(response.data.data);
    } catch (e) {
      if (epoch.current === version) setError(describeDashboardError(e, tr('预览验证失败', 'Preview validation failed')));
    } finally {
      setBusy(false);
    }
  };
  const updateJoin = (index: number, patch: Partial<TemplateSourceJoin>) =>
    editMapping({ joins: mapping.joins.map((j, i) => (i === index ? { ...j, ...patch } : j)) });
  return (
    <Modal
      open
      title={tr(template.title, templateEnglish[template.id]?.[0] || template.title)}
      width={1180}
      onCancel={() => {
        if (!busy) onClose();
      }}
      maskClosable={!busy}
      closable={!busy}
      footer={
        <div className={styles.footer}>
          {!preview && !aiAssisted && manual && info && (
            <span className={styles.mappingStatus} role='status'>
              {mappingNextStep}
            </span>
          )}
          <Button disabled={busy} onClick={onClose}>
            {tr('取消', 'Cancel')}
          </Button>
          {preview ? (
            <>
              <Button disabled={busy} onClick={() => setPreview(null)}>
                {tr('重新匹配', 'Remap')}
              </Button>
              <Button
                type='primary'
                loading={busy}
                onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  setError('');
                  try {
                    const r = await generateDashboardTemplate(
                      template.id,
                      source,
                      aiAssisted ? undefined : manual ? mapping : undefined,
                      // Model-free previews reuse the verified preset creation path.
                      aiAssisted && preview.adaptation?.model !== null ? preview.schema : undefined,
                    );
                    if (!r.data.success) throw new Error(r.data.err_msg || tr('生成失败', 'Generation failed'));
                    await router.push(`/dashboards/${r.data.data.id}`);
                  } catch (e) {
                    setError(describeDashboardError(e, tr('生成失败，请检查数据源', 'Generation failed. Check the data source.')));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {tr('创建看板', 'Create dashboard')}
              </Button>
            </>
          ) : (
            <Button
              type='primary'
              disabled={!canPreview || busy || loading}
              loading={busy}
              onClick={() => void check()}
            >
              {aiAssisted ? tr('AI 适配并预览', 'Adapt with AI and preview') : tr('验证并预览', 'Validate and preview')}
            </Button>
          )}
        </div>
      }
    >
      <Steps
        className={styles.steps}
        size='small'
        current={preview ? 2 : manual ? 1 : 0}
        items={[{ title: tr('选择数据', 'Choose data') }, { title: tr('AI 适配 / 字段匹配', 'AI adaptation / field mapping') }, { title: tr('预览并创建', 'Preview and create') }]}
      />
      {error && <Alert className={styles.error} type='error' showIcon message={error} />}
      {preview ? (
        <>
          <Alert
            type='success'
            showIcon
            message={
              preview.adaptation
                ? tr(`AI 适配完成，${preview.validation.widgets} 个组件查询验证通过`, `AI adaptation complete; ${preview.validation.widgets} widget queries validated`)
                : tr(`已读取 ${preview.validation.records?.toLocaleString('zh-CN')} 条明细，${preview.validation.widgets} 个组件及年份、分类筛选验证通过`, `Read ${preview.validation.records?.toLocaleString('en-US')} records; ${preview.validation.widgets} widgets and filters validated`)
            }
            description={tr('预览尚未保存。确认后创建看板，后续可继续编辑布局、筛选器或让数据助理修改。', 'The preview is not saved. Confirm to create a dashboard and continue editing it later.')}
          />
          {!!preview.adaptation?.changes?.length && (
            <details className='my-4 rounded-lg border border-[var(--app-border)] p-3'>
              <summary className='cursor-pointer text-sm font-medium'>{tr('AI 做了哪些适配', 'AI adaptations')}</summary>
              <ul className='mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--app-muted)]'>
                {preview.adaptation.changes.map((change, index) => (
                  <li key={index}>{change}</li>
                ))}
              </ul>
            </details>
          )}
          <div className={styles.preview}>
            <DashboardRenderer schema={preview.schema} snapshot={preview.snapshot} />
          </div>
        </>
      ) : (
        <div className={styles.form}>
          <label className={styles.full}>
            {tr('使用哪个数据源生成看板', 'Choose a data source')}
            <Select
              aria-label={tr('模板数据源', 'Template data source')}
              showSearch
              optionFilterProp='label'
              value={source || undefined}
              disabled={busy}
              options={sources.map(value => ({ value, label: dashboardSourceLabel(value) }))}
              onChange={value => {
                epoch.current++;
                setSource(value);
              }}
            />
            <span className='mt-2 block text-xs text-[var(--app-muted)]'>
              {tr('模板提供布局与计算方式，图表将查询这里所选数据源的实际数据。', 'The template supplies the layout and calculations; charts query the selected data source.')}
            </span>
          </label>
          {loading ? (
            <Spin />
          ) : (
            info && (
              <>
                <p className={styles.full}>{template.description}</p>
                <Radio.Group
                  className={`${styles.full} ${styles.matchingModes}`}
                  aria-label={tr('模板匹配方式', 'Template mapping method')}
                  value={aiAssisted ? 'ai' : manual ? 'manual' : 'preset'}
                  disabled={busy}
                  onChange={event => {
                    epoch.current++;
                    setAiAssisted(event.target.value === 'ai');
                    setManual(event.target.value === 'manual');
                    setPreview(null);
                    setError('');
                  }}
                >
                  <Radio value='ai' className={styles.matchOption}>
                    <span className={styles.matchIcon}>
                      <ThunderboltOutlined />
                    </span>
                    <span className={styles.matchCopy}>
                      <strong>{tr('AI 智能适配', 'AI adaptation')}</strong>
                      <small>{tr('理解数据，自动调整指标与图表', 'Adapt metrics and charts to the data')}</small>
                    </span>
                  </Radio>
                  {info.builtin_available && (
                    <Radio value='preset' className={styles.matchOption}>
                      <span className={styles.matchIcon}>
                        <CheckCircleOutlined />
                      </span>
                      <span className={styles.matchCopy}>
                        <strong>{tr('使用预设匹配', 'Use preset mapping')}</strong>
                        <small>{tr('沿用模板已配置的数据关系', 'Use the template’s configured data relationships')}</small>
                      </span>
                    </Radio>
                  )}
                  {['sqlite', 'sqlite3'].includes(info.dialect) && (
                    <Radio value='manual' className={styles.matchOption}>
                      <span className={styles.matchIcon}>
                        <SlidersOutlined />
                      </span>
                      <span className={styles.matchCopy}>
                        <strong>{tr('手动匹配字段', 'Map fields manually')}</strong>
                        <small>{tr('自主选择字段与计算口径', 'Choose fields and calculation definitions')}</small>
                      </span>
                    </Radio>
                  )}
                </Radio.Group>
                {aiAssisted ? (
                  <div
                    className={`${styles.full} rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4`}
                    data-testid='template-ai-assistant'
                  >
                    <div className='mb-2 flex items-center gap-2 font-semibold'>
                      <CommentOutlined />
                      {tr('模板 AI 助手', 'Template AI assistant')}
                    </div>
                    <p className='mb-3 text-sm leading-6 text-[var(--app-muted)]'>
                      {features ? tr('已提取模板的组件组合、布局和配色。', 'The template’s widgets, layout and colors have been extracted. ') : tr('将使用所选模板的组件组合、布局和配色。', 'The selected template’s widgets, layout and colors will be used. ')}
                      {tr('AI 会匹配你的数据；缺少字段时调整指标与图表，并验证实际查询结果。', 'AI maps your data, adapts missing fields and validates the query results.')}
                    </p>
                    <div className='mb-3 flex flex-wrap gap-1'>
                      {features?.widgets.map(widget => <Tag key={widget.id}>{widget.title}</Tag>)}
                    </div>
                    <details open>
                      <summary className='mb-2 cursor-pointer text-sm'>{tr('从模板提取的生成要求', 'Generation instructions extracted from the template')}</summary>
                      <Input.TextArea
                        aria-label={tr('模板 AI 生成要求', 'Template AI generation instructions')}
                        maxLength={6000}
                        value={aiPrompt}
                        disabled={busy}
                        autoSize={{ minRows: 4, maxRows: 8 }}
                        onChange={event => {
                          setAiPrompt(event.target.value);
                          epoch.current++;
                          setPreview(null);
                        }}
                      />
                    </details>
                    {busy && (
                      <div className='mt-3 flex items-center gap-2 text-xs text-[var(--app-muted)]' role='status'>
                        <Spin size='small' />
                        {tr('正在匹配字段、调整图表并验证查询…', 'Matching fields, adapting charts and validating queries…')}
                      </div>
                    )}
                  </div>
                ) : !manual ? (
                  <Alert
                    className={styles.full}
                    type='info'
                    showIcon
                    message={tr('已找到模板适配的表结构', 'Compatible table structure found')}
                    description={tr('此数据源包含模板预置适配所需的数据表。点击“验证并预览”检查查询与筛选结果；字段或业务粒度不同，可切换到“手动匹配字段”。预览确认后才会创建看板。', 'This data source has the tables required by the preset mapping. Validate and preview the queries and filters; use manual mapping if fields or grain differ. The dashboard is created only after confirmation.')}
                  />
                ) : (
                  <>
                    <Alert
                      className={styles.full}
                      type='info'
                      showIcon
                      message={tr(`手动匹配：已完成 ${requiredRoles.length - missingRoles.length}/${requiredRoles.length} 个必填字段`, `Manual mapping: ${requiredRoles.length - missingRoles.length}/${requiredRoles.length} required fields complete`)}
                      description={
                        <>
                          <p>{tr('先选业务明细表，再为模板指标选择含义相同的字段，最后确认单位和每行数据的业务含义。', 'Select a detail table, map fields with the same meaning as the template metrics, then confirm units and row grain.')}</p>
                          <p>
                            {tr('手动匹配沿用模板的指标含义。数据里没有对应字段时（例如销售数据没有年龄、血压），请使用 AI 智能适配，让指标随真实数据调整，或选择相同业务的模板。', 'Manual mapping preserves the template metric definitions. If the data lacks matching fields, use AI adaptation or choose a template for the same business domain.')}
                          </p>
                          <Button
                            size='small'
                            disabled={busy}
                            onClick={() => {
                              epoch.current++;
                              setAiAssisted(true);
                              setPreview(null);
                              setError('');
                            }}
                          >
                            {tr('缺少对应字段，改用 AI 智能适配', 'Fields missing? Use AI adaptation')}
                          </Button>
                        </>
                      }
                    />
                    <label>
                      {tr('业务明细表', 'Business detail table')}
                      <Select
                        aria-label={tr('业务明细表', 'Business detail table')}
                        placeholder={tr('第 1 步：选择存放业务记录的数据表', 'Step 1: select the table containing business records')}
                        value={mapping.table || undefined}
                        disabled={busy}
                        showSearch
                        options={info.tables.map(t => ({ label: t.name, value: t.name }))}
                        onChange={table => {
                          setConfirmedGrain(false);
                          editMapping({ table, fields: {}, joins: [] });
                        }}
                      />
                      <small>
                        {info.tables.length === 1
                          ? tr('此数据源只有一张表，已自动选中；请继续匹配下面的字段。', 'The only table was selected automatically. Continue mapping fields.')
                          : tr('选择一行代表一条业务记录的表；字段选择只显示这张表及已添加的关联表。', 'Choose a table where each row represents one business record; only it and joined tables are available for mapping.')}
                      </small>
                    </label>
                    <label>
                      {tr('日期格式', 'Date format')}
                      <Select
                        aria-label={tr('日期格式', 'Date format')}
                        disabled={busy}
                        value={mapping.date_format}
                        options={[
                          { value: 'iso', label: tr('年-月-日 / ISO 时间', 'Year-month-day / ISO timestamp') },
                          { value: 'dmy', label: tr('日-月-年（DD-MM-YYYY）', 'Day-month-year (DD-MM-YYYY)') },
                        ]}
                        onChange={date_format => editMapping({ date_format })}
                      />
                    </label>
                    <Collapse
                      className={styles.full}
                      items={[
                        {
                          key: 'joins',
                          label: tr(`关联分类表（可选，${mapping.joins.length}/3）`, `Join dimension tables (optional, ${mapping.joins.length}/3)`),
                          children: (
                            <div className={styles.joins}>
                              <p>
                                {tr('从明细表连接唯一键，不合并重复键。需要一对多或多个事实表时，请先整理为所需明细粒度。', 'Join the detail table to a unique key; duplicate keys are not merged. Prepare the required grain first for one-to-many joins or multiple fact tables.')}
                              </p>
                              {mapping.joins.map((join, i) => (
                                <div className={styles.join} key={i}>
                                  <Select
                                    aria-label={tr(`关联 ${i + 1} 左侧字段`, `Join ${i + 1} left field`)}
                                    placeholder={tr('左侧字段', 'Left field')}
                                    disabled={busy}
                                    options={fieldOptions([
                                      mapping.table,
                                      ...mapping.joins.slice(0, i).map(j => j.table),
                                    ])}
                                    value={fieldValue(join.left)}
                                    onChange={v => updateJoin(i, { left: JSON.parse(v) })}
                                  />
                                  <Select
                                    aria-label={tr(`关联 ${i + 1} 数据表`, `Join ${i + 1} table`)}
                                    placeholder={tr('分类表', 'Dimension table')}
                                    disabled={busy}
                                    options={info.tables
                                      .filter(t => t.name !== mapping.table)
                                      .map(t => ({ label: t.name, value: t.name }))}
                                    value={join.table || undefined}
                                    onChange={table => updateJoin(i, { table, right_column: '' })}
                                  />
                                  <Select
                                    aria-label={tr(`关联 ${i + 1} 唯一键`, `Join ${i + 1} unique key`)}
                                    placeholder={tr('分类表唯一键', 'Dimension table unique key')}
                                    disabled={busy}
                                    options={info.tables
                                      .find(t => t.name === join.table)
                                      ?.columns.map(c => ({ value: c.name, label: c.name }))}
                                    value={join.right_column || undefined}
                                    onChange={right_column => updateJoin(i, { right_column })}
                                  />
                                  <Button
                                    aria-label={tr(`移除关联 ${i + 1}`, `Remove join ${i + 1}`)}
                                    icon={<DeleteOutlined />}
                                    disabled={busy}
                                    onClick={() =>
                                      editMapping({ joins: mapping.joins.filter((_, n) => n !== i), fields: {} })
                                    }
                                  />
                                </div>
                              ))}
                              <Button
                                icon={<PlusOutlined />}
                                disabled={!mapping.table || busy || mapping.joins.length >= 3}
                                onClick={() =>
                                  editMapping({
                                    joins: [
                                      ...mapping.joins,
                                      { table: '', left: { table: '', column: '' }, right_column: '' },
                                    ],
                                  })
                                }
                              >
                                {tr('添加关联', 'Add join')}
                              </Button>
                            </div>
                          ),
                        },
                      ]}
                    />
                    {info.roles
                      .filter(r => r.required || ['value', 'entity'].includes(r.id))
                      .map(role => (
                        <label key={role.id}>
                          {role.label}
                          {role.required ? ' *' : tr('（可选）', ' (optional)')}
                          <Select
                            aria-label={tr(`匹配${role.label}`, `Map ${role.label}`)}
                            placeholder={
                              mapping.table ? tr(`选择含义对应“${role.label}”的字段`, `Select a field matching ${role.label}`) : tr('请先选择上方的业务明细表', 'Select the detail table above first')
                            }
                            disabled={busy || !mapping.table}
                            showSearch
                            optionFilterProp='label'
                            allowClear
                            value={fieldValue(mapping.fields[role.id])}
                            options={fieldOptions()}
                            onChange={value => {
                              const fields = { ...mapping.fields };
                              if (value) fields[role.id] = JSON.parse(value);
                              else delete fields[role.id];
                              editMapping({ fields });
                            }}
                          />
                          <small>{role.hint}</small>
                        </label>
                      ))}
                    <label>
                      {tr('主要数值单位', 'Primary value unit')}
                      <Input
                        aria-label={tr('主要数值单位', 'Primary value unit')}
                        disabled={busy}
                        placeholder={tr('例如：元、美元、次；纯计数模板填“条”', 'For example: USD or visits; use records for counts')}
                        maxLength={32}
                        value={mapping.unit}
                        onChange={e => editMapping({ unit: e.target.value })}
                      />
                    </label>
                    {template.id === 'northwind-customers' && (
                      <label>
                        {tr('留存观察周期', 'Retention interval')}
                        <Select
                          aria-label={tr('留存观察周期', 'Retention interval')}
                          disabled={busy}
                          value={mapping.interval}
                          options={[
                            { value: 'week', label: tr('按周（周一开始）', 'Weekly (starting Monday)') },
                            { value: 'month', label: tr('按自然月', 'Calendar month') },
                          ]}
                          onChange={interval => editMapping({ interval })}
                        />
                      </label>
                    )}
                    <Checkbox
                      className={styles.full}
                      checked={confirmedGrain}
                      disabled={busy}
                      onChange={e => setConfirmedGrain(e.target.checked)}
                    >
                      {tr('我确认明细表每行代表', 'I confirm each row represents ')}{grainLabels[info.grain]}{tr('，主要数值与所填单位一致。', ', and the main value matches the specified unit.')}
                    </Checkbox>
                  </>
                )}
              </>
            )
          )}
        </div>
      )}
    </Modal>
  );
}
