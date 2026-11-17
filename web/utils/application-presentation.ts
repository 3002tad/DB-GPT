import type { TeamMode } from '@/types/app';

const modesVi: Record<string, [string, string, string]> = {
  auto_plan: ['Nhiều Agent tự lập kế hoạch', 'Có thể chọn nhiều Agent', 'Tự chia mục tiêu thành nhiệm vụ, phối hợp các Agent và tổng hợp kết quả.'],
  awel_layout: ['Luồng AWEL', 'Chọn luồng AWEL đã tạo', 'Tổ chức và thực thi tác vụ theo luồng AWEL.'],
  single_agent: ['Một Agent', 'Chọn một Agent', 'Sử dụng một Agent để xử lý mục tiêu của người dùng.'],
  native_app: ['Ứng dụng có sẵn', 'Chọn mẫu ứng dụng', 'Tạo nhanh ứng dụng từ mẫu có sẵn.'],
};

export function applicationModeText(mode: TeamMode | undefined, language: string, field: 'name' | 'description' | 'remark' = 'name'): string {
  if (!mode) return '';
  const vi = modesVi[mode.value];
  if (language.startsWith('vi') && vi) return vi[field === 'name' ? 0 : field === 'description' ? 1 : 2];
  if (language.startsWith('zh')) return field === 'name' ? mode.name_cn : mode[field];
  return field === 'name' ? mode.name_en : field === 'description' ? mode.description_en : (mode as TeamMode & { remark_en?: string }).remark_en || mode.remark;
}

/** Native app prompt configuration supports en/zh; Vietnamese UI uses its
 * supported English fallback rather than introducing an unsupported prompt locale. */
export function applicationLanguage(language: string): 'en' | 'zh' {
  return language.startsWith('zh') ? 'zh' : 'en';
}
