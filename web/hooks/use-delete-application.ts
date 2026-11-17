import { delApp } from '@/client/api';
import type { IApp } from '@/types/app';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';

export function useDeleteApplication(onDeleted: () => void) {
  const { modal, message } = App.useApp();
  const { t } = useTranslation();

  return (app: Pick<IApp, 'app_code' | 'app_name'>) => {
    let pending = false;
    const dialog = modal.confirm({
      okButtonProps: { loading: false },
      cancelButtonProps: { disabled: false },
      closable: false,
      title: t('Delete'),
      content: `${t('want_delete')} ${app.app_name}`,
      okText: t('Delete'),
      okType: 'danger',
      cancelText: t('cancel'),
      onOk(close) {
        if (pending) return;
        pending = true;
        dialog.update({ okButtonProps: { loading: true }, cancelButtonProps: { disabled: true }, closable: false });
        // Use the explicit close callback: rejected API calls must not close the
        // dialog or escape as an unhandled promise rejection from AntD's button.
        void (async () => {
          try {
            const response = await delApp({ app_code: app.app_code });
            if (!response.data.success) throw new Error('Application deletion failed');
          } catch {
            message.error(t('error_occurred'));
            return;
          } finally {
            pending = false;
            dialog.update({ okButtonProps: { loading: false }, cancelButtonProps: { disabled: false } });
          }
          close();
          message.success(t('success'));
          onDeleted();
        })();
      },
    });
    return dialog;
  };
}
