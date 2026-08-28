// Поддельный клиент Supabase для самопроверки облачного режима без сети.
// Повторяет только те методы, которые использует приложение.
export function makeFakeSupabase() {
  const tables = { villas: new Map(), clients: new Map(), bookings: new Map(), app_settings: new Map(), files: new Map() };
  const storage = new Map();          // path -> Blob
  const calls = [];
  const keyOf = (t) => (t === 'app_settings' ? 'key' : 'id');

  function query(table) {
    const state = { filters: [], order: null, limitN: null, head: false, count: null };
    const rows = () => {
      let list = [...tables[table].values()];
      for (const [col, val] of state.filters) list = list.filter((r) => r[col] === val);
      for (const [col, val] of state.notFilters || []) list = list.filter((r) => r[col] !== val);
      if (state.order) {
        const { col, asc } = state.order;
        list.sort((a, b) => ((a[col] > b[col]) ? 1 : (a[col] < b[col] ? -1 : 0)) * (asc ? 1 : -1));
      }
      if (state.limitN != null) list = list.slice(0, state.limitN);
      return list;
    };
    const api = {
      select(cols, opts = {}) {
        calls.push(`select ${table}`);
        state.head = !!opts.head; state.count = opts.count || null;
        return api;
      },
      eq(col, val) { state.filters.push([col, val]); return api; },
      neq(col, val) { (state.notFilters ||= []).push([col, val]); return api; },
      order(col, opts = {}) { state.order = { col, asc: opts.ascending !== false }; return api; },
      limit(n) { state.limitN = n; return api; },
      async upsert(row) {
        calls.push(`upsert ${table}`);
        const arr = Array.isArray(row) ? row : [row];
        for (const r of arr) tables[table].set(r[keyOf(table)], { ...r });
        return { data: arr, error: null };
      },
      delete() {   // как в supabase-js: цепочка возвращается синхронно
        calls.push(`delete ${table}`);
        const del = {
          eq(col, val) { for (const [k, r] of tables[table]) if (r[col] === val) tables[table].delete(k); return Promise.resolve({ error: null }); },
          neq(col, val) { for (const [k, r] of tables[table]) if (r[col] !== val) tables[table].delete(k); return Promise.resolve({ error: null }); },
        };
        return del;
      },
      then(res, rej) {   // await на цепочке без терминального метода
        const list = rows();
        const payload = state.head
          ? { data: null, count: list.length, error: null }
          : { data: list.map((r) => ({ ...r })), count: state.count ? list.length : null, error: null };
        return Promise.resolve(payload).then(res, rej);
      },
    };
    return api;
  }

  return {
    _tables: tables, _storage: storage, _calls: calls,
    from: (t) => query(t),
    storage: {
      from() {
        return {
          async upload(path, blob, opts = {}) {
            calls.push('upload ' + path);
            if (storage.has(path) && !opts.upsert) return { data: null, error: { message: 'exists' } };
            storage.set(path, blob);
            return { data: { path }, error: null };
          },
          async remove(paths) {
            calls.push('remove ' + paths.length);
            paths.forEach((p) => storage.delete(p));
            return { data: null, error: null };
          },
          async download(path) {
            calls.push('download ' + path);
            if (!storage.has(path)) return { data: null, error: { message: 'not found: ' + path } };
            return { data: storage.get(path), error: null };
          },
          async createSignedUrls(paths) {
            calls.push('sign ' + paths.length);
            // как настоящий сервер: порядок сохраняем, а поле path НЕ отдаём —
            // проверяем, что приложение опирается на порядок, а не на path
            return { data: paths.map((p) => ({ signedUrl: 'https://fake.test/sign' + p, error: null })), error: null };
          },
        };
      },
    },
    auth: {
      async getSession() { return { data: { session: { user: { email: 'boss@example.com' } } } }; },
      async signInWithPassword() { return { data: { user: { email: 'boss@example.com' } }, error: null }; },
      async signOut() { return { error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    },
    channel() { const ch = { on() { return ch; }, subscribe() { return ch; } }; return ch; },
    removeChannel() {},
  };
}
