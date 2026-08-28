// ===== Подключение к общей базе (Supabase) =====
// Ключи можно вписать сюда — тогда они будут одинаковы на всех устройствах,
// либо ввести в приложении: «Настройки» → «Общая база».
// Публичный ключ (anon) безопасно хранить в открытом коде: доступ к данным
// определяется входом в систему и правилами RLS на стороне Supabase.
export const DEFAULT_SUPABASE_URL = '';
export const DEFAULT_SUPABASE_ANON_KEY = '';

export function cloudConfig() {
  return {
    url: (localStorage.getItem('supabaseUrl') || DEFAULT_SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    key: (localStorage.getItem('supabaseKey') || DEFAULT_SUPABASE_ANON_KEY || '').trim(),
  };
}
export function setCloudConfig(url, key) {
  localStorage.setItem('supabaseUrl', String(url || '').trim().replace(/\/+$/, ''));
  localStorage.setItem('supabaseKey', String(key || '').trim());
}
export function clearCloudConfig() {
  localStorage.removeItem('supabaseUrl');
  localStorage.removeItem('supabaseKey');
}
export const SUPABASE_JS = 'https://esm.sh/@supabase/supabase-js@2';
