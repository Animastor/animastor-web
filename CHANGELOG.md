# Changelog — animastor-web

Нормативно — `animastor-docs` (`CHANGELOG.md`, `architecture/ORCHESTRATION_V2.md` §11,
паритет — `architecture/ANDROID_WEB_PARITY.md`). Здесь — краткая запись по репозиторию.

## 2026-11-28 — удалены legacy-эндпоинты backend: чистка клиента (ветка `chore/remove-legacy-endpoints`)

- `api/client.ts` `isNoStorePath`: из списка убраны `progress-panel` и `generation*` (роуты удалены на backend,
  `ORCHESTRATION_V2.md` §11.3). Тот же список, что у backend `middleware/no-store.js` и Android `PollRequests.kt`.
- `api/models.ts`: удалены `RegenerateRequest` / `RegenerateResponse` (без использований); `ProgressPanelResponse` /
  `ProgressTask` остаются — это модель строк Генератора (`aggregateToPanel`).
- `features/generation/commandErrors.ts`: отказ старта распознаётся только в форме `/generate`
  (`code: layer_disabled`, `disabled_layers`); форма удалённого `/regenerate` больше не обрабатывается.
- Комментарии про `/regenerate` / `progress-panel` в `frontends/app` обновлены. UI не менялся. Пакеты
  `@animastor/web-*` не менялись (живых вызовов удалённых путей в них нет).
- vitest 475/0 (+1), `tsc --noEmit` OK, `vite build` OK.

## 2026-11-27 — no-store для `/book/:id/generate/*` (ветка `fix/gen-listen-nostore`)

- `api/client.ts` `isNoStorePath`: добавлен `/book/:id/generate(/…)` — `GET /generate/progress` (полл панели) и
  `/generate/stream` идут с `cache: 'no-store'` (О1); `/generate-next` по-прежнему по умолчанию. Тот же список, что у
  backend `middleware/no-store.js` и Android `PollRequests.kt`.
- Тест `client.nostore.test.ts` +4 пути. vitest 474/0, `tsc --noEmit` OK, `vite build` OK.

## 2026-11-27 — generate API v2 (ветка `feat/generate-api-v2`)

- Генератор (`frontends/app`) говорит с новым API оркестрации (ADR ORCHESTRATION_V2 §11.1–11.2):
  `POST /book/:id/generate` `{scope, layers, mode, client_action_id}`, `POST /generate/stop`,
  `GET /generate/progress`, SSE `GET /generate/stream`. Вместо `/regenerate`, `cancel-generation`,
  `cancel-worker` (для слоёв), `progress-panel`; `build_id` из ответа больше не читается
  (`setGenerationBuildId` генерацией не вызывается).
- Диалог масштаба слоя — две кнопки: «Сгенерировать недостающее» (`mode:"missing"`) и
  «Перегенерировать» (`mode:"all"`, `window.confirm`, если область шире сцены). VBook «Сгенерировать всё» — без изменений.
- `client_action_id` = id нажатия (`userAction`); повтор того же id сервер возвращает как `existing`;
  «всё уже готово» (`jobs_created 0`, `skipped_ready > 0`) — отдельный тост.
- Стоп трёх видов: ■ строки → `{command_id}`, ■ раздела → `{layer}`, «Стоп всё» → `{}`; VBook / обложка —
  по-прежнему `cancel-worker` (задача H).
- Прогресс: полл `GET /generate/progress` → `aggregateToPanel` → `computeProgressRows` (пакет
  `@animastor/web-generator` не менялся); SSE `/generate/stream` (`genProgress`, переподключение 1–10 с);
  `/progress-stream` остаётся для событий VBook / анализа.
- Новые файлы: `features/generation/generateApi.ts` (+ `generateApi.test.ts`),
  `state/generateStore.genStream.test.ts`; обновлены тесты генератора и два guard-теста архитектуры.
  vitest 470/0, `tsc --noEmit` OK, `vite build` OK.
- **Совместимость:** нужен backend с `/generate*` (ветка `feat/generate-api-v2` backend).
