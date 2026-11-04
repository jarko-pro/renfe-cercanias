# Cercanías en directo

Mapa con las estaciones de Cercanías/Rodalies de Renfe y cuántos minutos faltan para los próximos trenes, con retrasos en tiempo real.

## Arrancar

```bash
npm install
npm run dev        # API en :3001 + web en http://localhost:5173
npm test           # tests del cálculo de llegadas
```

La primera vez el servidor descarga el GTFS de Renfe (~16 MB) en `server/data/` y lo indexa (~5 s).

## Estructura

- `shared/`: tipos comunes (`Stop`, `Arrival`...).
- `server/`: API Fastify.
  - `src/gtfs/`: descarga y lectura en streaming del GTFS. Solo se indexan los viajes de ayer, hoy y mañana, y se recarga al cambiar de día.
  - `src/realtime/poller.ts`: lee `trip_updates.pb` cada 30 s.
  - `src/arrivals.ts`: horario programado + retraso real → próximos trenes.
- `web/`: React + Vite + Leaflet. Los favoritos van en `localStorage` detrás de `FavoritesStore` (`web/src/lib/favorites.ts`).

## API

| Endpoint | Descripción |
| --- | --- |
| `GET /api/stops` | Todas las estaciones con sus líneas (con ETag) |
| `GET /api/stops/:id/arrivals` | Próximos trenes (90 min) |
| `GET /api/health` | Estado del GTFS y del tiempo real |

## Fuentes de datos

Datos abiertos de Renfe:
- GTFS de Cercanías: `https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip`
- Tiempo real: `https://gtfsrt.renfe.com/trip_updates.pb`

El horario de Renfe tiene huecos conocidos, así que la app marca cada tren como "en tiempo real" o "programado".

## Próximos pasos

- **Móvil**: en `web/` ejecutar `npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios`, después `npx cap init` (webDir `dist`) y `npx cap add android`. Desplegar el servidor y compilar con `VITE_API_URL=https://tu-api`.
- **Favoritos con cuenta**: crear una implementación remota de `FavoritesStore` (API + auth).
