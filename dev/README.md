# Файлы для самопроверки

`fake-supabase.js` — поддельный клиент Supabase: повторяет только те методы, которые
использует приложение (таблицы в памяти, хранилище файлов, подписанные ссылки, вход).
Нужен, чтобы прогнать облачный режим без реального проекта и без сети.

Как пользоваться: открыть приложение с локального сервера и в консоли браузера
подставить клиент вместо настоящего:

```js
const cloud = await import('/js/cloud.js');
const { makeFakeSupabase } = await import('/dev/fake-supabase.js');
localStorage.setItem('supabaseUrl', 'https://fake.supabase.co');
localStorage.setItem('supabaseKey', 'fake-anon-key');
cloud.__setTestClient(makeFakeSupabase());
```

В приложении это не участвует: загружается только вручную.
