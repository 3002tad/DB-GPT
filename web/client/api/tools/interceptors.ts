import { notification } from 'antd';
import { AxiosError } from 'axios';
import i18next from 'i18next';
import { ApiResponse, FailedTuple, ResponseType, SuccessTuple } from '../';

/**
 * Response processing
 *
 * @param promise request
 * @param ignoreCodes ignore error codes
 * @returns
 */
export const apiInterceptors = <T = any, D = any>(
  promise: Promise<ApiResponse<T, D>>,
  ignoreCodes?: '*' | (number | string)[],
) => {
  return promise
    .then<SuccessTuple<T, D>>(response => {
      const { data } = response;
      if (!data) {
        throw new Error(i18next.t('ui_network_error', { defaultValue: 'Network error' }));
      }
      if (!data.success) {
        if (ignoreCodes === '*' || (data.err_code && ignoreCodes && ignoreCodes.includes(data.err_code))) {
          return [null, data.data, data, response];
        } else {
          notification.error({
            message: i18next.t('ui_request_error', { defaultValue: 'Request error' }),
            description: data?.err_msg ?? i18next.t('ui_api_unavailable', { defaultValue: 'Service unavailable. Please try again later.' }),
          });
        }
      }
      return [null, data.data, data, response];
    })
    .catch<FailedTuple<T, D>>((err: Error | AxiosError<T, D>) => {
      let errMessage = err.message;
      if (err instanceof AxiosError) {
        try {
          const { err_msg } = JSON.parse(err.request.response) as ResponseType<null>;
          err_msg && (errMessage = err_msg);
        } catch {
          /* empty */
        }
      }
      notification.error({
        message: i18next.t('ui_request_error', { defaultValue: 'Request error' }),
        description: errMessage,
      });
      return [err, null, null, null];
    });
};
