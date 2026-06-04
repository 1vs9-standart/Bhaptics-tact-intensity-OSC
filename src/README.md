# Структура `src/`

```
src/
├── index.js              # Точка входа: связывает все подсистемы
├── config.js             # Алиас на systemSettings (user-settings.json)
│
├── settings/
│   └── store.js          # Загрузка/сохранение настроек, onSettingsUpdate
│
├── util/
│   └── port-check.js     # Проверка и освобождение портов при старте
│
├── vrchat/               # Всё, что приходит из VRChat по OSC
│   ├── osc-listener.js   # UDP-сервер :9001, приём /avatar/parameters/*
│   ├── oscquery.js       # mDNS OSCQuery + bulk-снапшот параметров
│   ├── log-port.js       # Fallback: порт OSCQuery из output_log
│   ├── vrc-config-check.js  # Реестр Windows: OSC on, interact level
│   └── ogb-parser.js     # Парсер OGB/TPS/VFH (протокол ERP-аватаров)
│
├── bhaptics/             # Жилет TactSuit (bHaptics Player в браузере)
│   ├── state-analyzer.js # Контакты из OSC → value/velocity/duration
│   ├── intensity-engine.js # Сглаживание и пороги силы вибрации
│   └── motor-utils.js    # Зоны и моторы жилета (кластеры, 32 мотора)
│
├── lovense/              # Lovense / Intiface (Buttplug WebSocket)
│   ├── engine.js         # Интенсивность из OSC (OGB или legacy include)
│   ├── bridge.js         # Подключение к Intiface, vibrate/stop
│   └── loop.js           # Tick ~15 Гц → bridge + maxLevelParam в VRChat
│
└── dashboard/            # Web UI + WebSocket к tact-js в браузере
    ├── server.js         # Express, API, WS /haptics → bHaptics Player
    └── state.js          # Общее runtime-состояние для UI
```

## Поток данных

```
VRChat OSC (UDP :9001)
    │
    ├─► vrchat/osc-listener ──► index.js
    │         │
    │         ├─► bhaptics/state-analyzer ──► intensity-engine ──► dashboard/hapticsBridge ──► браузер (tact-js)
    │         │
    │         └─► lovense/engine ──► lovense/loop ──► lovense/bridge ──► Intiface
    │
    └─► vrchat/oscquery (bulk + адрес отправки OSC)
```

## Где что искать

| Задача | Папка / файл |
|--------|----------------|
| Не приходят параметры VRChat | `vrchat/osc-listener.js`, `settings/store.js` → `osc.port` |
| OSCQuery / bulk | `vrchat/oscquery.js` |
| Жилет не вибрирует | `bhaptics/*`, `dashboard/server.js` (WS клиент в браузере) |
| Lovense не работает | `lovense/*` |
| Настройки UI / API | `dashboard/server.js`, `settings/store.js` |
| OGB ERP-параметры | `vrchat/ogb-parser.js`, `lovense/engine.js` |
