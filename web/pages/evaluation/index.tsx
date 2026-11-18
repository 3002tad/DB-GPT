import {
  apiInterceptors,
  createEvaluations,
  delDataSet,
  delEvaluation,
  downloadDataSet,
  downloadEvaluation,
  getAppList,
  getDataSets,
  getEvaluations,
  getMetrics,
  getSpaceList,
  getStorageTypes,
  showEvaluation,
  updateEvaluations,
  uploadDataSetsContent,
  uploadDataSetsFile,
} from '@/client/api';
import { InfoCircleOutlined, UploadOutlined } from '@ant-design/icons';
import { useRequest } from 'ahooks';
import type { TableProps } from 'antd';
import {
  Badge,
  Button,
  ConfigProvider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import { valueType } from 'antd/es/statistic/utils';
import { useMemo, useState } from 'react';
import { useUiText } from '@/hooks/use-ui-text';

const { TextArea } = Input;
const { useWatch } = Form;

interface DataSetItemType {
  code: string;
  name: string;
  file_type: string;
  storage_type: string;
  storage_position: string;
  datasets_count: string;
  have_answer: boolean;
  members: string;
  user_name: string;
  user_id: string;
  sys_code: string;
  gmt_create: string;
  gmt_modified: string;
}
interface EvaluationItemType {
  evaluate_code: string;
  scene_key: string;
  scene_value: string;
  datasets: string;
  evaluate_metrics: string;
  context: object;
  user_name: string;
  user_id: string;
  sys_code: string;
  parallel_num: string;
  state: string;
  result: string;
  average_score: string;
  log_info: string;
  gmt_create: string;
  gmt_modified: string;
}
const Evaluation = () => {
  const tr = useUiText();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDataSetModalOpen, setIsDataSetModalOpen] = useState(false);
  const [evaluationList, setEvaluationList] = useState<EvaluationItemType[]>([]);
  const [evaluationTotal, setEvaluationTotal] = useState<number>(0);
  const [dataSetsTotal, setDataSetsTotal] = useState<number>(0);

  const [sceneValueOptions, setSceneValueOptions] = useState<{ label: string; value: string }[]>();
  const [metricOptions, setMetricOptions] = useState<{ label: string; value: string }[]>();
  const [sceneValueOptionLoading, setSceneValueOptionLoading] = useState(false);
  const [currentTable, setCurrentTable] = useState('evaluations');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isAddDataSet, setIsAddDataSet] = useState(true);
  const [evaluationShowData, setEvaluationShowData] = useState<Record<string, string>[]>([{}]);
  const [storageTypeOptions, setStorageTypeOptions] = useState<{ label: string; value: string }[]>();
  const [dataSetsList, setDataSetsList] = useState<DataSetItemType[]>([]);
  const [currentEvaluationCode, setCurrentEvaluationCode] = useState<string>('');
  const [dataSetModalLoading, setDataSetModalLoading] = useState(false);
  const [evaluationModalLoading, setEvaluationModalLoading] = useState(false);
  const [commonLoading, setCommonLoading] = useState(false);

  const dataSetsOptions = useMemo(() => {
    return dataSetsList?.map(item => {
      return {
        label: item?.name,
        value: item?.code,
      };
    });
  }, [dataSetsList]);
  const [form] = Form.useForm();
  const [dataSetForm] = Form.useForm();
  //getMetrics
  const { run: runGetMetrics, loading: getMetricsLoading } = useRequest(
    async params => {
      const [_, data] = await apiInterceptors(getMetrics(params));
      return data;
    },
    {
      manual: true,
      onSuccess: data => {
        setMetricOptions(
          data?.map((i: Record<string, string>) => {
            return { label: i.name, value: i.name };
          }),
        );
      },
    },
  );
  //showEvaluation
  const { run: runShowEvaluation, loading: showEvaluationLoading } = useRequest(
    async params => {
      const [_, data] = await apiInterceptors(showEvaluation(params));
      return data;
    },
    {
      manual: true,
      onSuccess: data => {
        if (data && data.length) {
          setEvaluationShowData(data);
          setIsModalVisible(true);
        }
      },
    },
  );

  useRequest(async () => {
    const [, data] = await apiInterceptors(getStorageTypes());
    setStorageTypeOptions(Array.isArray(data) ? data.flatMap(item =>
      Object.entries(item).map(([value, label]) => ({ label: String(label), value }))) : []);
  });

  const {
    run: runGetEvaluations,
    loading: getEvaluationsLoading,
    refresh: getEvaluationsRefresh,
  } = useRequest(
    async (page = 1, page_size = 10) => {
      const [_, data] = await apiInterceptors(
        getEvaluations({
          page,
          page_size,
        }),
      );
      return data;
    },
    {
      // manual: true,
      onSuccess: data => {
        setEvaluationList(data?.items || []);
        setEvaluationTotal(data?.total_count || 0);
      },
    },
  );
  const {
    run: runGetDataSets,
    loading: getDataSetsLoading,
    refresh: getDataSetsRefresh,
  } = useRequest(
    async (page = 1, page_size = 10) => {
      const [_, data] = await apiInterceptors(
        getDataSets({
          page,
          page_size,
        }),
      );
      return data;
    },
    {
      // manual: true,
      onSuccess: data => {
        setDataSetsList(data?.items || []);
        setDataSetsTotal(data?.total_count || 0);
      },
    },
  );

  // TODO: unuesed function
  // // uploadDataSets
  // const {
  //   run: runUploadDataSets,
  //   loading: uploadDataSetsLoading,
  //   refresh: uploadDataSetsRefresh,
  // } = useRequest(
  //   async data => {
  //     const [_, res] = await apiInterceptors(
  //       uploadDataSets({
  //         ...data,
  //       }),
  //     );
  //     return res;
  //   },
  //   {
  //     manual: true,
  //     onSuccess: res => {
  //       setEvaluationList(res?.items);
  //     },
  //   },
  // );

  const columns: TableProps<DataSetItemType>['columns'] = [
    {
      title: tr('名称', 'Evaluation name'),
      dataIndex: 'name',
      key: 'name',
      width: '10%',
      fixed: 'left',
    },
    {
      title: tr('编码', 'Dataset code'),
      dataIndex: 'code',
      key: 'code',
      width: '20%',
      // render: (text) => <a>{text}</a>,
    },
    {
      title: tr('储存方式', 'Dataset storage'),
      dataIndex: 'storage_type',
      key: 'storage_type',
    },
    {
      title: tr('数据集数量', 'Dataset row count'),
      dataIndex: 'datasets_count',
      key: 'datasets_count',
    },

    {
      title: tr('创建时间', 'Created at'),
      dataIndex: 'gmt_create',
      key: 'gmt_create',
    },
    {
      title: tr('成员', 'Dataset members'),
      dataIndex: 'members',
      key: 'members',
      width: '10%',
      render: text => {
        return text?.split(',').map((item: string) => {
          return <Tag key={item}>{item}</Tag>;
        });
      },
    },
    {
      title: tr('更新时间', 'Updated at'),
      dataIndex: 'gmt_modified',
      key: 'gmt_modified',
    },
    {
      title: tr('操作', 'Actions'),
      key: 'action',
      render: (_, record) => (
        <Space size='middle'>
          <Popconfirm
            title={tr('确认删除吗', 'Delete this evaluation item?')}
            onConfirm={async () => {
              const [, , res] = await apiInterceptors(
                delDataSet({
                  code: record?.code,
                }),
              );
              if (res?.success == true) {
                message.success(tr('删除成功', 'Deleted successfully'));
                getDataSetsRefresh();
              }
            }}
          >
            <Button type='link'>{tr('删除', 'Delete')}</Button>
          </Popconfirm>
          <Button
            type='link'
            onClick={() => {
              setIsAddDataSet(false);
              setIsDataSetModalOpen(true);
              setCurrentEvaluationCode(record?.code);
              dataSetForm.setFieldsValue({
                dataset_name: record?.name,
                members: record?.members?.split(','),
              });
            }}
          >
            {tr('编辑', 'Edit')}
          </Button>
          <Button
            type='link'
            loading={commonLoading}
            onClick={async () => {
              setCommonLoading(true);
              const response = await downloadDataSet({
                code: record?.code,
              });
              const contentType = response.headers['content-type'] || '';
              if (contentType.includes('application/json')) {
                // 如果是 JSON，解析错误信息
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const error = JSON.parse(reader.result as string);
                    message.error(error.err_msg);
                    // 在页面或通知系统中展示错误信息
                  } catch (parseError) {
                    console.error('Failed to parse error response:', parseError);
                  }
                };
                reader.readAsText(response.data as any);
              } else {
                // 从响应头中获取文件名
                const contentDisposition = response.headers['content-disposition'];
                let filename = 'dataset.csv';
                if (contentDisposition) {
                  const match = contentDisposition.match(/filename\*?="?(.+)"/);
                  if (match?.[1]) {
                    filename = decodeURIComponent(match[1]);
                  }
                }

                // 创建 URL 并触发下载
                const url = window.URL.createObjectURL(
                  new Blob([response.data as any], {
                    type: contentType || 'text/csv',
                  }),
                );
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url); // 释放内存
              }
              setCommonLoading(false);
            }}
          >
            {tr('下载', 'Download')}
          </Button>
        </Space>
      ),
    },
  ];
  /* evaluations Columns
   */
  const evaluationsColumns: TableProps<EvaluationItemType>['columns'] = [
    {
      title: tr('数据集名称', 'Dataset name'),
      dataIndex: 'datasets_name',
      key: 'datasets_name',
      fixed: 'left',
      width: '15%',
      render: text => (
        <span
          style={{
            textWrap: 'nowrap',
            maxWidth: '300px',
          }}
        >
          {text}
        </span>
      ),
    },
    {
      title: tr('测评状态', 'Evaluation state'),
      dataIndex: 'state',
      key: 'state',
      render: text => {
        return <Badge style={{ textWrap: 'nowrap' }} status={text == 'failed' ? 'error' : 'success'} text={text} />;
      },
    },
    {
      title: tr('测评编码', 'Evaluation code'),
      dataIndex: 'evaluate_code',
      key: 'evaluate_code',
    },
    {
      title: tr('场景', 'Evaluation scene'),
      dataIndex: 'scene_key',
      key: 'scene_key',
    },

    {
      title: tr('测评指标', 'Evaluation metrics'),
      dataIndex: 'evaluate_metrics',
      key: 'evaluate_metrics',
    },
    {
      title: tr('创建时间', 'Created at'),
      dataIndex: 'gmt_create',
      key: 'gmt_create',
    },
    {
      title: tr('更新时间', 'Updated at'),
      dataIndex: 'gmt_modified',
      key: 'gmt_modified',
    },
    Table.EXPAND_COLUMN,
    {
      title: (
        <span className='w-[50px]'>
          <span className='text-nowrap'>{tr('详情', 'Details')}</span>
          <Tooltip placement='topLeft' title={tr('查看日志与评分', 'View evaluation logs and scores')}>
            <InfoCircleOutlined />
          </Tooltip>
        </span>
      ),
      render: () => (
        <div
          style={{
            minWidth: '50px',
          }}
        ></div>
      ),
    },
    {
      title: tr('测评结果', 'Evaluation results'),
      key: 'result',
      render: (_, record) => (
        <>
          <Button
            type='link'
            loading={showEvaluationLoading}
            onClick={async () => {
              runShowEvaluation({
                evaluate_code: record?.evaluate_code,
              });
            }}
          >
            {tr('评分明细', 'Evaluation score details')}
          </Button>
          <Button
            type='link'
            loading={commonLoading}
            onClick={async () => {
              setCommonLoading(true);
              const response = await downloadEvaluation({
                evaluate_code: record?.evaluate_code,
              });
              const contentType = response.headers['content-type'] || '';

              if (contentType.includes('application/json')) {
                // 如果是 JSON，解析错误信息
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const error = JSON.parse(reader.result as string);
                    message.error(error.err_msg);
                    // 在页面或通知系统中展示错误信息
                  } catch (parseError) {
                    console.error('Failed to parse error response:', parseError);
                  }
                };
                reader.readAsText(response.data as any);
              } else {
                // 从响应头中获取文件名
                const contentDisposition = response.headers['content-disposition'];
                let filename = 'dataset.csv';
                if (contentDisposition) {
                  const match = contentDisposition.match(/filename\*?="?(.+)"/);
                  if (match?.[1]) {
                    filename = decodeURIComponent(match[1]);
                  }
                }

                // 创建 URL 并触发下载
                const url = window.URL.createObjectURL(
                  new Blob([response.data as any], {
                    type: contentType || 'text/csv',
                  }),
                );
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url); // 释放内存
              }
              setCommonLoading(false);
            }}
          >
            {tr('下载', 'Download')}
          </Button>
        </>
      ),
    },
    {
      title: tr('操作', 'Actions'),
      key: 'action',
      width: '25%',
      render: (_, record) => (
        <>
          <Popconfirm
            title={tr('确认删除吗', 'Delete this evaluation item?')}
            onConfirm={async () => {
              const [, , res] = await apiInterceptors(
                delEvaluation({
                  evaluation_code: record?.evaluate_code,
                }),
              );
              if (res?.success == true) {
                message.success(tr('删除成功', 'Deleted successfully'));
                getEvaluationsRefresh();
              }
            }}
          >
            <Button type='link'>{tr('删除', 'Delete')}</Button>
          </Popconfirm>
        </>
      ),
    },
  ];
  const handleModalClose = () => {
    setIsModalVisible(false);
  };
  return (
    <ConfigProvider
      theme={{
        components: {
          Segmented: {
            itemSelectedBg: '#2867f5',
            itemSelectedColor: 'white',
          },
        },
      }}
    >
      <div className='flex flex-col h-full w-full  dark:bg-gradient-dark bg-gradient-light bg-cover bg-center'>
        <div className='px-6 py-2 overflow-y-auto'>
          <Segmented
            className='backdrop-filter backdrop-blur-lg bg-white bg-opacity-30 border-2 border-white rounded-lg shadow p-1 dark:border-[#6f7f95] dark:bg-[#6f7f95] dark:bg-opacity-60'
            options={[
              {
                label: tr('评测数据', 'Evaluations'),
                value: 'evaluations',
              },
              {
                label: tr('数据集', 'Datasets'),
                value: 'dataSet',
              },
            ]}
            onChange={type => {
              setCurrentTable(type as string);
            }}
            value={currentTable}
          />
          {currentTable === 'dataSet' && (
            <>
              <div className='flex flex-row-reverse mb-4'>
                <Button
                  className='border-none text-white bg-button-gradient h-full'
                  onClick={() => {
                    setIsDataSetModalOpen(true);
                    setIsAddDataSet(true);
                  }}
                >
                  {tr('添加数据集', 'Add dataset')}
                </Button>
              </div>
              <Table
                pagination={{
                  total: dataSetsTotal,
                  onChange(page) {
                    runGetDataSets(page);
                  },
                }}
                scroll={{ x: 1300 }}
                loading={getDataSetsLoading}
                columns={columns}
                dataSource={dataSetsList}
              />
            </>
          )}
          {currentTable === 'evaluations' && (
            <>
              <div className='flex flex-row-reverse mb-4'>
                <Button
                  className='border-none text-white bg-button-gradient h-full'
                  onClick={() => {
                    setIsModalOpen(true);
                  }}
                >
                  {tr('发起评测', 'Run evaluation')}
                </Button>
              </div>
              <Table
                pagination={{
                  total: evaluationTotal,
                  onChange(page) {
                    runGetEvaluations(page);
                  },
                }}
                rowKey={record => record.evaluate_code}
                expandable={{
                  expandedRowRender: ({ average_score, log_info }) => {
                    return (
                      <div className='flex flex-col gap-2'>
                        {(() => {
                          if (!average_score) return <></>;
                          try {
                            const jsonData = JSON.parse(average_score);
                            return (
                              <div className='flex flex-row gap-1'>
                                {Object.entries(jsonData)?.map(item => {
                                  const [k, v] = item;
                                  return <Statistic title={k} key={k} value={v as valueType} />;
                                })}
                              </div>
                            );
                          } catch {
                            return <></>;
                          }
                        })()}
                        {log_info && (
                          <div>
                            <span className='text-gray-500 text-sm'>log：</span>
                            <span>{log_info}</span>
                          </div>
                        )}
                      </div>
                    );
                  },
                }}
                scroll={{ x: '100%' }}
                loading={getEvaluationsLoading}
                columns={evaluationsColumns}
                dataSource={evaluationList}
              />
            </>
          )}
          <Modal
            title={tr('发起测评', 'Run evaluation')}
            open={isModalOpen}
            onOk={async () => {
              const values = await form.validateFields();
              setEvaluationModalLoading(true);
              if (values) {
                const [, , res] = await apiInterceptors(
                  createEvaluations({
                    ...values,
                  }),
                );
                if (res?.success) {
                  message.success(tr('发起成功', 'Evaluation finished'));
                  getEvaluationsRefresh();
                  form.resetFields();
                  setIsModalOpen(false);
                }
              }
              setEvaluationModalLoading(false);
            }}
            confirmLoading={evaluationModalLoading}
            onCancel={() => {
              setIsModalOpen(false);
            }}
          >
            <Form
              name='basic'
              form={form}
              initialValues={{ remember: true }}
              autoComplete='off'
              labelCol={{ span: 4 }}
              wrapperCol={{ span: 20 }}
            >
              <Form.Item name='scene_key' label={tr('场景类型', 'Evaluation scene type')} rules={[{ required: true }]}>
                <Select
                  options={[
                    {
                      value: 'recall',
                      label: tr('召回评测', 'Retrieval evaluation'),
                    },
                    {
                      value: 'app',
                      label: tr('应用评测', 'Application evaluation'),
                    },
                  ]}
                  onChange={async value => {
                    //getSceneValueOptions
                    setSceneValueOptionLoading(true);
                    form.setFieldValue('scene_value', '');
                    if (value === 'recall') {
                      const res = await getSpaceList();
                      if (res.data.success) {
                        setSceneValueOptions(
                          res.data.data.map(i => ({
                            label: i.name,
                            value: i.id.toString(),
                          })),
                        );
                      }
                    } else {
                      const res = await getAppList({});
                      if (res.data.success) {
                        setSceneValueOptions(
                          res.data.data.app_list.map(i => ({
                            label: i.app_name,
                            value: i.app_code,
                          })),
                        );
                      }
                    }
                    setSceneValueOptionLoading(false);
                  }}
                ></Select>
              </Form.Item>
              <Form.Item name='scene_value' label={tr('场景参数', 'Evaluation target')} rules={[{ required: true }]}>
                <Select
                  loading={sceneValueOptionLoading}
                  disabled={sceneValueOptionLoading}
                  options={sceneValueOptions}
                  onChange={value => {
                    if (form.getFieldValue('scene_key')) {
                      runGetMetrics({
                        scene_key: form.getFieldValue('scene_key'),
                        scene_value: value,
                      });
                    }
                  }}
                ></Select>
              </Form.Item>
              <Form.Item name='parallel_num' label={tr('并行参数', 'Evaluation concurrency')} rules={[{ required: true }]} initialValue={1}>
                <Input></Input>
              </Form.Item>
              <Form.Item name='datasets' label={tr('数据集', 'Datasets')} rules={[{ required: true }]}>
                <Select options={dataSetsOptions}></Select>
              </Form.Item>
              <Form.Item
                name='evaluate_metrics'
                label={tr('评测指标', 'Evaluation metrics')}
                rules={[{ required: useWatch('scene_key', form) === 'app' }]}
              >
                <Select loading={getMetricsLoading} disabled={getMetricsLoading} options={metricOptions}></Select>
              </Form.Item>
            </Form>
          </Modal>
          <Modal
            title={isAddDataSet ? tr('添加数据集', 'Add dataset') : tr('编辑数据集', 'Edit dataset')}
            open={isDataSetModalOpen}
            confirmLoading={dataSetModalLoading}
            onOk={() => {
              dataSetForm.validateFields().then(values => {
                setDataSetModalLoading(true);
                if (isAddDataSet) {
                  const storageType = values.storage_type;
                  if (storageType === 'file') {
                    // 创建FormData对象
                    const formData = new FormData();
                    formData.append('dataset_name', values.dataset_name);
                    values.members && formData.append('members', (values.members || []).join(','));

                    const upload = values.doc_file?.[0] || values.doc_file;
                    const file = upload?.file?.originFileObj || upload?.file || upload?.originFileObj || upload;
                    if (!(file instanceof Blob)) {
                      message.error(tr('上传失败', 'Dataset upload failed'));
                      setDataSetModalLoading(false);
                      return;
                    }
                    formData.append('doc_file', file, file instanceof File ? file.name : 'dataset.json');

                    uploadDataSetsFile(formData)
                      .then(response => {
                        if (response.data.success) {
                          message.success(tr('上传成功', 'Dataset uploaded'));
                          runGetDataSets();
                        } else {
                          message.error(response.data.err_msg);
                        }
                      })
                      .catch(error => {
                        console.error(tr('上传失败', 'Dataset upload failed'), error);
                        message.error(error?.response?.data?.err_msg || tr('上传失败', 'Dataset upload failed'));
                      })
                      .finally(() => {
                        setIsDataSetModalOpen(false);
                        setDataSetModalLoading(false);
                      });
                  } else if (storageType === 'db') {
                    uploadDataSetsContent({
                      dataset_name: values.dataset_name,
                      members: (values.members || []).join(','),
                      content: values.content,
                    })
                      .then(res => {
                        if (res.data.success) {
                          message.success(tr('上传成功', 'Dataset uploaded'));
                          runGetDataSets();
                        } else {
                          message.error(res.data.err_msg);
                        }
                      })
                      .catch(err => {
                        console.log(err);
                        message.error(err?.response?.data?.err_msg || tr('上传失败', 'Dataset upload failed'));
                      })
                      .finally(() => {
                        setIsDataSetModalOpen(false);
                        setDataSetModalLoading(false);
                        dataSetForm.resetFields();
                      });
                  }
                } else {
                  updateEvaluations({
                    code: currentEvaluationCode,
                    members: (values.members || []).join(','),
                  })
                    .then(res => {
                      if (res.data.success) {
                        message.success(tr('更新成功', 'Dataset updated'));
                        runGetDataSets();
                      } else {
                        message.error(res.data.err_msg);
                      }
                    })
                    .catch(err => {
                      console.log(err);
                      message.error(tr('更新失败', 'Dataset update failed'));
                    })
                    .finally(() => {
                      setIsDataSetModalOpen(false);
                      setDataSetModalLoading(false);
                    });
                }
              });
            }}
            onCancel={() => {
              setIsDataSetModalOpen(false);
            }}
          >
            <Form
              name='basic'
              form={dataSetForm}
              initialValues={{ remember: true }}
              autoComplete='off'
              labelCol={{ span: 4 }}
              wrapperCol={{ span: 20 }}
            >
              <Form.Item name='dataset_name' label={tr('名称', 'Evaluation name')} rules={[{ required: true }]}>
                <Input disabled={!isAddDataSet} />
              </Form.Item>
              <Form.Item name='members' label={tr('成员', 'Dataset members')}>
                <Select mode='tags' />
              </Form.Item>
              {isAddDataSet && (
                <Form.Item name='storage_type' label={tr('储存类型', 'Storage type')} rules={[{ required: true }]}>
                  <Select options={storageTypeOptions?.map(item => ({ ...item, label: item.value === 'db' ? tr('数据库 JSON', 'Database JSON') : tr('上传文件（数据库存储）', 'Upload file (database storage)') }))} />
                </Form.Item>
              )}
              {useWatch('storage_type', dataSetForm) === 'file' && isAddDataSet && (
                <Form.Item name='doc_file' label={tr('数据集文件', 'Dataset file')} valuePropName='fileList'
                  getValueFromEvent={event => Array.isArray(event) ? event : event?.fileList}
                  rules={[{ required: true }]}>
                  <Upload
                    name='dataSet'
                    accept='.json,.jsonl,.csv'
                    maxCount={1}
                    beforeUpload={() => false}
                  >
                    <Button icon={<UploadOutlined />}>{tr('上传数据集', 'Upload dataset')}</Button>
                  </Upload>
                </Form.Item>
              )}
              {useWatch('storage_type', dataSetForm) === 'db' && isAddDataSet && (
                <Form.Item name='content' label={tr('JSON 内容', 'JSON content')} rules={[{ required: true }]}>
                  <TextArea rows={8} placeholder={'[{"query":"Question","factual":"Expected answer"}]'} />
                </Form.Item>
              )}
            </Form>
          </Modal>
          <Modal
            title={tr('评分明细', 'Evaluation score details')}
            open={isModalVisible}
            onOk={handleModalClose}
            onCancel={handleModalClose}
            styles={{
              body: {
                maxHeight: '500px',
                overflowY: 'auto',
                minWidth: '700px',
              },
            }}
            style={{
              minWidth: '750px',
            }}
            footer={[
              <Button key='back' onClick={handleModalClose}>
                {tr('返回', 'Back')}
              </Button>,
            ]}
          >
            <Table
              columns={Object.keys(evaluationShowData?.[0]).map(key => ({
                title: key,
                dataIndex: key,
                key,
              }))}
              style={{
                minWidth: '700px',
              }}
              dataSource={evaluationShowData}
              rowKey='code'
              pagination={false} // 禁用分页
            />
          </Modal>
        </div>
      </div>
    </ConfigProvider>
  );
};

export default Evaluation;
