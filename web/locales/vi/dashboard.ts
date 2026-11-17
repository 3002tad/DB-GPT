import dashboardEn from '../en/dashboard';
import { viUiText } from './ui-text';

// Register the namespace as Vietnamese too: components using i18next directly
// must not resolve this namespace to English while the rest of the UI is vi.
// Untranslated extended help keeps the readable English fallback.
const dashboardVi: Record<string, string> = Object.fromEntries(
  Object.entries(dashboardEn).map(([key, english]) => [key, viUiText[english] || english]),
);
export default dashboardVi;
