# Play Console: todo lo que hay que rellenar

Copia y pega en Play Console. Lo que está en `bloques de código` va tal cual.

---

## 1. Crear la app

| Campo | Valor |
| --- | --- |
| Nombre de la app | `Cercanías en directo` |
| Idioma predeterminado | Español (España) – es-ES |
| App o juego | App |
| Gratis o de pago | Gratis |

---

## 2. Ficha principal de Play Store

### Nombre (máx. 30)

```
Cercanías en directo
```

### Descripción breve (máx. 80)

```
Tu tren de Cercanías en tiempo real: cuánto falta, retrasos, vía y avisos.
```

### Descripción completa (máx. 4000)

```
¿Cuánto le falta a mi tren? Abre la app, toca tu estación y lo sabrás al momento.

Cercanías en directo te muestra los próximos trenes de Cercanías de cualquier estación con los datos en tiempo real de Renfe: cuántos minutos faltan, a qué hora pasa y si va con retraso. Sencilla, rápida y pensada para el día a día de quien va a trabajar o a clase en tren.

LO QUE PUEDES HACER
• Ver los próximos trenes de tu estación, con salidas y llegadas.
• Saber si tu tren va en hora o con retraso, con colores del verde al rojo.
• Ver la vía por la que entra el tren, cuando Renfe la publica.
• Seguir tu tren en el mapa: dónde está ahora y el recorrido que le queda.
• Buscar un tren por su número de 5 cifras.
• Guardar tus estaciones favoritas con la ⭐ para tenerlas a mano.
• Consultar los avisos e incidencias que afectan a tu estación.
• Detectar trenes «Sin confirmar»: deberían estar circulando pero Renfe no da señal (posible retraso o cancelación).

FUNCIONA EN TODOS LOS NÚCLEOS
Madrid, Rodalies de Catalunya, Valencia, Sevilla, Málaga, Cádiz, Bilbao, San Sebastián, Santander, Asturias, León, Ferrol, Murcia/Alicante, Cartagena y Zaragoza.

GRATIS, SIN REGISTRO Y SIN ANUNCIOS
No hace falta crear una cuenta. No hay publicidad. Tus favoritas se guardan solo en tu móvil.

Los datos se actualizan cada 30 segundos, que es lo que tarda Renfe en publicarlos.

App no oficial. Cercanías en directo es una aplicación independiente: no está desarrollada, patrocinada ni respaldada por Renfe. Usa los datos abiertos que publica Renfe Operadora.

¿Has visto un fallo o tienes una idea? Escríbenos a contacto@cercaniasendirecto.com
```

### Recursos gráficos (en esta carpeta)

| Campo | Archivo |
| --- | --- |
| Icono de la app (512×512) | `../store_icon.png` |
| Gráfico destacado (1024×500) | `imagen-destacada-1024x500.png` |
| Capturas de teléfono (2–8) | `tienda-1-estacion.png`, `tienda-2-seguir-tren.png`, `tienda-3-mapa.png`, `tienda-5-ayuda.png` (en este orden) |

Las capturas sin marco están en `capturas/`, por si prefieres subirlas tal cual.
Capturas de tablet: no son obligatorias. Si Play las pide para tablet de 7" o 10", valen las mismas.

---

## 3. Configuración de la tienda

| Campo | Valor |
| --- | --- |
| Categoría | **Mapas y navegación** (alternativa: Viajes y guías locales) |
| Etiquetas | Transporte público, Trenes, Horarios |
| Correo electrónico | `contacto@cercaniasendirecto.com` |
| Sitio web | `https://cercaniasendirecto.com` |
| Teléfono | (vacío, es opcional) |

---

## 4. Contenido de la aplicación (Política → Contenido de la aplicación)

### Política de privacidad
```
https://cercaniasendirecto.com/privacidad.html
```

### Acceso a la aplicación
**Todas las funciones están disponibles sin restricciones de acceso** (no hay inicio de sesión).

### Anuncios
**No, mi aplicación no contiene anuncios.**

### Clasificación de contenido
- Correo: `contacto@cercaniasendirecto.com`
- Categoría: **Todas las demás tipos de aplicaciones** (no es juego, ni red social, ni de noticias).
- Responde **No** a todo: violencia, sexo, lenguaje, drogas, apuestas, interacción entre usuarios, compartir ubicación con otros usuarios, compras digitales.
  - Ojo: «¿Comparte la ubicación del usuario con otros usuarios?» → **No** (la ubicación solo centra el mapa en el móvil).
- Resultado esperado: PEGI 3 / Para todos.

### Público objetivo
- Edades: **13–15, 16–17 y 18 o más**. No marques menores de 13: activa la política de familias y pide mucho más.
- ¿Puede atraer a niños?: **No**.

### Aplicación de noticias
**No.**

### Aplicaciones gubernamentales
**No.** (Importante: no es una app oficial ni de una entidad pública).

### Funciones financieras / Salud
**Mi app no tiene ninguna** / **No.**

### ID de publicidad
**No.** La app no declara el permiso `AD_ID` (comprobado en el manifiesto final: no pide ningún permiso).

### Seguridad de los datos

Coherente con la política de privacidad (estadísticas anónimas con Umami).

**Recogida y seguridad**
- ¿Recoge o comparte datos de usuario de los tipos requeridos? → **Sí**
- ¿Se cifran todos los datos en tránsito? → **Sí** (todo va por HTTPS)
- ¿Cómo pueden solicitar la eliminación? marca que los usuarios **pueden solicitar que se eliminen sus datos** e indica el correo `contacto@cercaniasendirecto.com` (no hay cuentas).

**Tipos de datos: marca solo estos**

| Tipo | ¿Recogido? | ¿Compartido? | ¿Efímero? | ¿Obligatorio? | Finalidad |
| --- | --- | --- | --- | --- | --- |
| Ubicación → **Ubicación aproximada** | Sí | No | No | Obligatorio | Analíticas |
| Actividad en apps → **Interacciones con la aplicación** | Sí | No | No | Obligatorio | Analíticas |

Notas para no liarse:
- La ubicación aproximada es el país y la ciudad que Umami calcula a partir de la IP; la IP no se guarda.
- La ubicación precisa («Mi ubicación») se usa solo en el móvil y **no** sale de él, así que **no** se declara.
- «Compartido» = No: Umami y Render son proveedores que procesan los datos por nuestra cuenta, y Google no lo considera compartir.
- No marques: información personal, identificadores del dispositivo, información financiera, mensajes, fotos, contactos, diagnósticos.

---

## 5. Prueba cerrada

1. **Probar y publicar → Pruebas → Prueba cerrada → Crear canal** (o usar «Alpha»).
2. **Países:** España.
3. **Testers:** crea una lista de correo con los Gmail de los testers (mínimo 12). También vale un grupo de Google.
4. **Crear versión → subir** `../cercanias.aab`. Acepta la **Firma de aplicaciones de Play**.
5. **Nombre de la versión:** `1.0.0`
6. **Notas de la versión:**
   ```
   <es-ES>
   Primera versión: próximos trenes en tiempo real, retrasos, vía, avisos, seguimiento del tren en el mapa y favoritas.
   </es-ES>
   ```
7. Envía a revisión. Cuando se apruebe, copia el **enlace de participación** y mándaselo a los testers.
8. Los **14 días** cuentan desde que hay **12 testers que han aceptado e instalado** la app. Tienen que mantenerla instalada esos 14 días.

**Después de subir el .aab:** Configuración → Integridad de la aplicación → Firma de aplicaciones → copia el **SHA-256 de la clave de firma de apps** y pásamelo para añadirlo a `assetlinks.json`.

### Mensaje para buscar testers (foro)

```
¡Hola! Cercanías en directo va a estar en Google Play 🚆

Para poder publicarla, Google me pide que al menos 12 personas la prueben durante 14 días antes. Si usas Android y te apetece echar una mano:

1. Mándame por privado el correo de tu cuenta de Google (el de Play Store).
2. Te paso un enlace para unirte a la prueba e instalarla desde Play Store.
3. Solo tienes que dejarla instalada 14 días (y usarla si te viene bien 😉).

Es la misma app que la web cercaniasendirecto.com: gratis, sin registro y sin anuncios. ¡Gracias!
```

### Cuando pasen los 14 días
Panel → **Solicitar acceso a producción**. Google hace unas preguntas sobre la prueba (cuántos testers, qué feedback hubo, qué cambiaste). Respuestas honestas y breves; por ejemplo: «12+ testers usaron la app a diario en sus trayectos. Ajustamos X según su feedback.»
