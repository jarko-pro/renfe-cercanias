/** Mismo icono que en las filas del panel: el tren se puede seguir en el mapa. */
const PIN = (
  <svg className="live-pin" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"
    />
  </svg>
);

/**
 * Ayuda corta (botón "?" del buscador). En el móvil no hay tooltips, así que es el único
 * sitio donde se explica qué significa cada etiqueta. Usa las mismas etiquetas que el panel.
 */
export function HelpCard() {
  return (
    <div className="search-results help-card" role="dialog" aria-label="Cómo funciona">
      <h2>Cómo se usa</h2>
      <ul className="help-steps">
        <li>Toca una estación en el mapa o búscala por su nombre.</li>
        <li>También puedes buscar un tren por su número (5 cifras).</li>
        <li>
          Pulsa <span className="help-star">★</span> en una estación para tenerla a mano la próxima vez.
        </li>
      </ul>

      <h2>Qué significa cada cosa</h2>
      <dl className="help-legend">
        <dt className="help-scale">
          {[
            ['d0', 'En hora'],
            ['d1', '+2'],
            ['d2', '+4'],
            ['d3', '+8'],
            ['d4', '+15'],
          ].map(([c, t]) => (
            <span key={c} className={`badge live ${c}`}>
              <span className="dot" />
              {t}
            </span>
          ))}
        </dt>
        <dd className="help-scale">Dato en tiempo real de Renfe: el tren va en hora o con esos minutos de retraso. Del verde al rojo según cuánto se retrasa.</dd>

        <dt>
          <span className="badge muted">Programado</span>
        </dt>
        <dd>Renfe no da datos en directo de este tren todavía: es la hora del horario.</dd>

        <dt>
          <span className="badge unconfirmed">Sin confirmar</span>
        </dt>
        <dd>Ya debería estar circulando, pero Renfe no da señal. Puede ir con retraso o estar cancelado.</dd>

        <dt>{PIN}</dt>
        <dd>Toca el tren para seguirlo en el mapa.</dd>

        <dt>
          <span className="badge platform">Vía 3</span>
        </dt>
        <dd>Vía por la que entra el tren, cuando Renfe la da.</dd>

        <dt>⚠ Avisos</dt>
        <dd>Incidencias de Renfe que afectan a la estación.</dd>

        <dt>
          <span className="help-grey">En gris</span>
        </dt>
        <dd>Hace rato que no llegan datos nuevos. Revisa tu conexión.</dd>
      </dl>

      <p className="help-foot">
        Datos abiertos de Renfe, actualizados cada 30 s. No es una app oficial de Renfe.{' '}
        <a href="/privacidad.html" target="_blank" rel="noopener">Privacidad</a>
      </p>
    </div>
  );
}
