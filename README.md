# Cercanías en directo

**👉 [cercaniasendirecto.com](https://cercaniasendirecto.com)**

Cuánto le falta a cada tren de Cercanías para llegar a tu estación, en tiempo real: retraso, vía, avisos y dónde va el tren. Funciona en Madrid, Rodalies de Catalunya, Valencia, Sevilla, Málaga, Bilbao, Asturias y el resto de núcleos de Renfe. Gratis, sin registro y sin anuncios.

No es una app oficial de Renfe: usa los datos abiertos que publica Renfe.

## Cómo se usa

1. Toca una estación en el mapa o búscala por su nombre.
2. Verás los próximos trenes: cuánto falta, a qué hora pasa y si va con retraso.
3. Pulsa ⭐ para guardar la estación y tenerla a mano la próxima vez.
4. ¿Sabes el número de tu tren? Escribe sus 5 cifras en el buscador.
5. Los trenes con 📍 se pueden seguir en el mapa: toca la fila.

Cada estación tiene su propia dirección (por ejemplo [/estacion/sol/](https://cercaniasendirecto.com/estacion/sol/)), que puedes compartir o guardar.

**Instalarla como app:** en Android, menú del navegador → *Añadir a pantalla de inicio*. En iPhone, botón *Compartir* → *Añadir a pantalla de inicio*.

### Qué significa cada cosa

| Etiqueta | Significado |
| --- | --- |
| **En hora** / **+3 min** | Dato en tiempo real de Renfe: el tren va en hora o con ese retraso. |
| **Programado** | Renfe aún no da datos en directo de ese tren: es la hora del horario. |
| **Sin confirmar** | Ya debería estar circulando, pero Renfe no da señal. Puede ir con retraso o estar cancelado. |
| 📍 | Se puede seguir el tren en el mapa. |
| **Vía 3** | Vía por la que entra el tren, cuando Renfe la da. |
| ⚠ **Avisos** | Incidencias de Renfe que afectan a la estación. |
| Lista **en gris** | Hace rato que no llegan datos nuevos (normalmente, por falta de cobertura). |

Los datos se actualizan cada 30 segundos, que es lo que tarda Renfe en publicarlos.

## ¿Has visto un fallo o tienes una idea?

Abre un [*Issue*](https://github.com/jarko-pro/renfe-cercanias/issues) contando qué estación, qué línea y a qué hora, o escribe a [contacto@cercaniasendirecto.com](mailto:contacto@cercaniasendirecto.com). Una captura de pantalla ayuda mucho.

---

## Para desarrolladores

### Arrancar en local

Necesitas Node 22.

```bash
npm install
npm run dev        # API en :3001 + web en http://localhost:5173
npm test           # tests del servidor
npm run typecheck
```

La primera vez, el servidor descarga el GTFS de Renfe (~16 MB) en `server/data/` y lo indexa (~5 s). Sin `DATABASE_URL`, el histórico de retrasos se calcula pero no se guarda.

### Estructura

- `shared/`: tipos comunes (`Stop`, `Arrival`…) y los slugs de las páginas de estación.
- `server/`: API con Fastify.
  - `src/gtfs/`: descarga y lectura en streaming del GTFS. Solo se indexan los viajes de ayer, hoy y mañana, y se recarga al cambiar de día.
  - `src/realtime/`: lee cada 30 s los feeds de tiempo real (retrasos, posiciones y avisos).
  - `src/arrivals.ts`: horario programado + retraso real → próximos trenes.
  - `src/live.ts`, `src/shape.ts`: posición y trazado del tren que se sigue.
  - `src/alerts.ts`: avisos por estación. Renfe no da gravedad ni fecha de fin, así que se deducen del texto.
  - `src/history/`: histórico de retrasos de cada tren en Postgres.
  - `src/stats.ts`: reenvía las estadísticas de uso a Umami, sin guardar IPs.
- `web/`: React + Vite + Leaflet.
  - `scripts/station-pages.ts`: tras el build, genera una página estática por estación, el `404.html` y el `sitemap.xml`.
  - Las favoritas y la última vista del mapa se guardan en `localStorage`.

### API

| Endpoint | Descripción |
| --- | --- |
| `GET /api/stops` | Todas las estaciones con sus líneas (con ETag) |
| `GET /api/stops/:id/arrivals` | Próximos trenes (90 min) y avisos de la estación |
| `GET /api/trips/:tripId/live` | Posición en directo de un tren |
| `GET /api/trips/:tripId/shape` | Trazado de un tren |
| `GET /api/trains/:number` | Buscar un tren por su número |
| `GET /api/health` | Estado del GTFS y del tiempo real |

### Fuentes de datos

Datos abiertos de Renfe ([data.renfe.com](https://data.renfe.com/)):
- GTFS de Cercanías: `https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip`
- Retrasos: `https://gtfsrt.renfe.com/trip_updates.pb`
- Posiciones: `https://gtfsrt.renfe.com/vehicle_positions.pb`
- Avisos: `https://gtfsrt.renfe.com/alerts.pb`

Algunas cosas que conviene saber de los datos de Renfe:
- El horario tiene huecos, así que cada tren se marca como en tiempo real, programado o sin confirmar.
- El andén va dentro de la etiqueta del vehículo (`PLATF.(6)`).
- Cuando un tren va "en tránsito", Renfe da la parada que acaba de **dejar**, no la siguiente (al contrario que el estándar).

### Publicación

- **Web**: GitHub Pages, en `cercaniasendirecto.com`. Se despliega sola con `.github/workflows/pages.yml` en cada push a `main` que cambie `web/` o `shared/`. Lee la URL del servidor de la variable de repositorio `API_URL`, y el ID de Umami de `UMAMI_ID`.
- **Servidor**: Render, plan gratuito, definido en `render.yaml`. El plan gratuito se duerme tras 15 min sin uso; para evitarlo, el propio servidor llama a su URL pública cada 10 min (`.github/workflows/keepalive.yml` hace de respaldo). La web guarda la lista de estaciones en el dispositivo y reintenta sola si el servidor está despertando.
