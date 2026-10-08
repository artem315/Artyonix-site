# ArtyMods 2.0 — independent Minecraft mods platform

Этот проект **не подключается к Modrinth** и не копирует его каталог. В архиве собственный Node.js сервер, адаптивный сайт и исходники Android приложения (Java + WebView). Всё управляется твоим сервером.

## Важно перед запуском

**Сервер НЕ развёрнут в интернете, а APK НЕ скомпилирован.** Это готовые исходники для самостоятельного запуска и сборки. Кнопка «Скачать APK» есть на сайте и будет отдавать настоящий файл, **когда ты положишь собранный `ArtyMods.apk` в `server/public/downloads/`**. Пока APK отсутствует, кнопка корректно возвращает 404.

## Локальный запуск в Termux

```sh
pkg update
pkg install nodejs-lts python git unzip openjdk-17 -y
termux-setup-storage
cd ~/storage/downloads
unzip ArtyMods-Independent.zip -d ~
cd ~/ArtyMods-Independent/server
node server.js
```

Открой **http://localhost:3000**. Никаких `npm install` или Supabase для сервера не требуется! Это локально; пользователи в интернете пока не могут к нему подключаться.

### Развернуть собственный сервер

Нужен доступный из интернета сервер (например VPS) с Node.js 20+ и **HTTPS-доменом**. Скопируй папку `server/`, настрой обратный прокси (Caddy/Nginx) на `http://127.0.0.1:3000`, настрой домен и TLS, запусти `node server.js` в долгоживущем процессе (systemd/pm2). Не открывай 3000 в интернет без TLS. Данные и загруженные JAR/ZIP сохраняются на своём диске `server/data/` и `server/uploads/` — нужны резервные копии. Для большого сообщества JSON-хранилище следует заменить СУБД и объектным хранилищем; текущая реализация подходит для небольшого сервера и разработки.

По умолчанию загруженные моды **попадают на проверку и не отображаются в общем каталоге**. Автоматическая модерация / антивирус не реализованы. Перед публикацией администратор обязан проверять файлы. Настрой сильный `ADMIN_TOKEN` при запуске:

```sh
export ADMIN_TOKEN="$(openssl rand -hex 32)"
export PORT=3000
node server.js
```

Проверка очереди (на сервере):

```sh
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/admin/pending
```

Одобрение конкретного безопасного проверенного файла:

```sh
curl -X POST http://localhost:3000/api/admin/review \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"ID_ПРОЕКТА","status":"approved"}'
```

### Подключить Android к своему серверу

**До сборки APK** укажи постоянный публичный HTTPS-адрес своего сервера:

```sh
cd ~/ArtyMods-Independent
python scripts/configure_android.py https://mods.example.com
```

Заменяй `https://mods.example.com` на свой реальный домен. Указывать адрес сервера внутри приложения не нужно — вкладки «Мой сайт» больше нет.

Чтобы WebView на телефоне мог обращаться к серверу, установи на сервере:

```sh
export APP_ORIGINS="https://app.artymods.local"
```

Этот встроенный синтетический URL — только origin локального интерфейса WebView, **не чужой сервер**. Авторизация, каталог и все файлы используются только с указанного домена.

### Сборка APK на Android/Termux

Исходники — `android/` (Android Gradle Plugin 8.7.3, Java 17, compileSdk 35). Для сборки требуется полноценный **Android SDK** (`platforms;android-35` и `build-tools;35.0.0`) и рабочий для архитектуры Termux `aapt2`.

```sh
cd ~/ArtyMods-Independent/android
export ANDROID_HOME="$HOME/android-sdk"  # замени на путь к установленному Android SDK
# echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew assembleDebug  # при наличии gradle wrapper
# или: gradle assembleDebug
```

`gradlew` в архиве не включён; если в Termux уже есть Gradle и настроенный Android SDK, используй `gradle assembleDebug`. Gradle из Termux может быть несовместим с определённой версией Android Gradle Plugin — в этом случае лучше Android Studio/CI. APK после сборки: `android/app/build/outputs/apk/debug/app-debug.apk`.

Для кнопки на сайте положи его на сервер как:

```
server/public/downloads/ArtyMods.apk
```

После этого `https://ТВОЙ-ДОМЕН/downloads/ArtyMods.apk` будет скачивать APK напрямую.

## Что работает

- Нативная оболочка Android с встроенным интерфейсом, без Modrinth API
- Свой Node.js HTTP API (`/api`), аккаунты с salted scrypt паролями
- Поиск и фильтры, настоящий список загруженных на свой сервер файлов
- Публикация JAR/ZIP (до 50 МБ), проверка ZIP-сигнатуры, ручная модерация
- Прямое скачивание через свой домен, количество скачиваний
- Адаптивный веб-сайт с кнопкой скачивания APK

## Ограничения

- Никакие чужие каталоги не импортируются, до первой публикации проектов будет 0.
- Нет готового публичного хостинга или домена, уведомлений, восстановления пароля и антивирусной проверки.
- Сайт рассчитан на небольшой самостоятельный сервер, не на крупную платформу без дополнительной инфраструктуры.
- Не распространяй APK, пока не настроишь HTTPS-адрес внутри `android/app/src/main/assets/index.html` через скрипт.
- Загруженные файлы потенциально опасны. Только ручная проверка перед одобрением.

ArtyMods — независимый фан-проект, не связан с Mojang/Microsoft или Modrinth.

## Можно собрать APK вообще без ПК и Android SDK

В репозитории есть готовый GitHub Actions workflow `.github/workflows/build-apk.yml`. В GitHub создай репозиторий и добавь файлы из **корня** этого архива. В `Settings → Secrets and variables → Actions → Variables` добавь `ARTYMODS_API_URL` со своим **реальным** HTTPS-доменом. Затем `Actions → Build ArtyMods APK → Run workflow`. В завершённом запуске появится артефакт `ArtyMods-APK` с файлом `ArtyMods.apk`. Загрузить его в `server/public/downloads/` можно через SFTP либо прямо на VPS с телефона. Workflow не запустит и не опубликует сервер вместо тебя.

## Docker для VPS (по желанию)

`server/Dockerfile` и `server/compose.yml` позволяют поднять свой Node.js backend в Docker. Сначала в `server/public/downloads/` положи собранный APK, настрой `ADMIN_TOKEN`, затем из `server/` запусти `docker compose up -d --build`. Caddyfile-пример: `deploy/Caddyfile.example`. Для HTTPS нужен домен с работающим DNS и сервер с открытыми портами 80/443.

## Деплой на Render

В корне репозитория есть `package.json`, `server.js` (запускает `server/server.js`) и `render.yaml`.

- **Runtime:** Node (20+)
- **Build Command:** `npm install`
- **Start Command:** `node server.js`
- **Health Check Path:** `/api/health`

Либо `New → Blueprint` и выбери этот репозиторий — Render возьмёт настройки из `render.yaml` и сам сгенерирует `ADMIN_TOKEN` (посмотреть его можно в Environment сервиса). Порт Render передаёт через `PORT`, сервер его читает.

⚠️ На бесплатном тарифе Render диск временный: `server/data/` (аккаунты, проекты) и `server/uploads/` (файлы модов) стираются при каждом деплое/перезапуске. Для постоянного хранения подключи Persistent Disk (платный тариф) к папке `server/data` и `server/uploads` или вынеси данные во внешнюю БД/хранилище.
