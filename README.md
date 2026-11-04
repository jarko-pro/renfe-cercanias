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

## Publicación

- **Web**: GitHub Pages. Se despliega sola con `.github/workflows/pages.yml` en cada push a `main` que cambie `web/` o `shared/`.
- **Servidor**: Render, plan gratuito, definido en `render.yaml`. En el plan gratuito se duerme tras 15 min sin uso. Para evitarlo, un monitor externo gratuito (cron-job.org) llama a `/api/health` cada 5 min. `.github/workflows/keepalive.yml` hace lo mismo de respaldo, pero GitHub retrasa o se salta a menudo las tareas programadas, así que no basta por sí sola.
- La web guarda la lista de estaciones en el dispositivo y reintenta sola si el servidor está despertando, así que el mapa y las favoritas funcionan desde el primer momento.
- La web lee la URL del servidor de la variable de repositorio `API_URL` (Settings → Secrets and variables → Actions → Variables). Si la cambias, relanza el workflow.

## Próximos pasos

- **Móvil**: en `web/` ejecutar `npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios`, después `npx cap init` (webDir `dist`) y `npx cap add android`. Compilar con `VITE_API_URL` apuntando al servidor de Render.
- **Favoritos con cuenta**: crear una implementación remota de `FavoritesStore` (API + auth).
