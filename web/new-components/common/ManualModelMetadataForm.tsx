import type { ManualModelDeclaration } from '@/types/model';
import { Alert, Button, Form, Input, InputNumber, Select } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function ManualModelMetadataForm({ value, onSave }: {
  value?: Partial<ManualModelDeclaration>;
  onSave: (value: ManualModelDeclaration) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    form.setFieldsValue({
      context_length: value?.context_length ?? null,
      max_output_length: value?.max_output_length ?? null,
      reference: value?.reference ?? '',
      checked_at: value?.checked_at ?? '',
      function_mode: value?.function_calling == null ? 'unknown' : value.function_calling ? 'yes' : 'no',
    });
  }, [form, value]);
  const requiredSource = ({ getFieldValue }: { getFieldValue: (key: string) => unknown }) => ({
    validator(_: unknown, input: unknown) {
      const declared = getFieldValue('context_length') != null || getFieldValue('max_output_length') != null || getFieldValue('function_mode') !== 'unknown';
      return declared && !String(input || '').trim() ? Promise.reject(new Error(t('provider_metadata_reference_required'))) : Promise.resolve();
    },
  });
  return <Form form={form} layout='vertical' initialValues={{ function_mode: 'unknown' }} onFinish={async values => {
    setSaving(true);
    try {
      await onSave({
        context_length: values.context_length ?? null,
        max_output_length: values.max_output_length ?? null,
        function_calling: values.function_mode === 'unknown' ? null : values.function_mode === 'yes',
        reference: values.reference?.trim() || null,
        checked_at: values.checked_at || null,
      });
    } finally { setSaving(false); }
  }}>
    <Alert type='info' showIcon message={t('provider_metadata_manual_hint')} className='mb-4' />
    <Form.Item name='context_length' label={t('provider_metadata_context')}>
      <InputNumber min={1} precision={0} className='w-full' />
    </Form.Item>
    <Form.Item name='max_output_length' label={t('provider_metadata_output')} dependencies={['context_length']} rules={[({ getFieldValue }) => ({
      validator(_, output) {
        const context = getFieldValue('context_length');
        return output != null && context != null && output > context ? Promise.reject(new Error(t('provider_metadata_output_invalid'))) : Promise.resolve();
      },
    })]}>
      <InputNumber min={1} precision={0} className='w-full' />
    </Form.Item>
    <Form.Item name='function_mode' label={t('function_calling')}>
      <Select options={[{ value: 'unknown', label: t('provider_metadata_unspecified') }, { value: 'yes', label: t('provider_metadata_yes') }, { value: 'no', label: t('provider_metadata_no') }]} />
    </Form.Item>
    <Form.Item name='reference' label={t('provider_metadata_reference')} dependencies={['context_length', 'max_output_length', 'function_mode']} rules={[requiredSource]}>
      <Input maxLength={2048} />
    </Form.Item>
    <Form.Item name='checked_at' label={t('provider_metadata_checked_at')} dependencies={['context_length', 'max_output_length', 'function_mode']} rules={[requiredSource]}>
      <Input type='date' />
    </Form.Item>
    <Form.Item><Button htmlType='submit' type='primary' loading={saving}>{t('submit')}</Button></Form.Item>
  </Form>;
}
