# Operar el relay beta

Node 24, una sola instancia. En producción es obligatorio usar PostgreSQL y REQUIRE_DURABLE=true. Desde `public-plugin`:

```sh
npm ci
npm run verify
PUBLIC_ORIGIN=http://127.0.0.1:8787 npm run relay
```

Para una prueba externa prepara un host HTTPS de staging. Establece `PUBLIC_ORIGIN=https://nombre-del-relay.example`, `HOST=0.0.0.0` y `PORT` según el host. Usa `node relay/server.mjs` después de `npm run build`. El reverse proxy debe preservar **Host** y no registrar Authorization, códigos OAuth, formularios ni cuerpos. `/health` es el health check. El servidor rechaza otros Host y Origin. TLS termina en el proxy de confianza. No uses HTTP público. No se despliega automáticamente este servidor ni se publica una URL como servicio oficial.

Endpoints públicos: `/health`, `/pair`, `/register`, `/authorize`, `/token`, descubrimiento OAuth. `/pair` crea una bandeja vacía con credencial de dispositivo y código de emparejamiento de 256 bits válido cinco minutos; no concede acceso a otra bandeja. El formulario OAuth exige el código de la app, nonce de transacción, redirect registrado exacto y PKCE S256. OAuth concede solo `inbox`, con audience/resource exacto `/mcp`. Código de autorización de un uso y 60 segundos. Token de escritor de hasta una hora y credencial de renovación rotatoria, vinculada al cliente, recurso y ámbito originales. Se acepta inbox y, opcionalmente, offline_access. La renovación caduca a los 30 días desde el consentimiento, a los 7 días sin renovar o al alcanzar 1.024 rotaciones. Reutilizar una credencial gastada revoca el grant de ese cliente. Cliente y dispositivo usan credenciales independientes; no pueden intercambiar roles. Revocar el dispositivo invalida su escritor y su cola.

Endpoints de dispositivo: `/plugin/poll`, `/plugin/receipt`, `/plugin/revoke`. El plugin actualiza permisos en cada sondeo; aun si ChatGPT conserva una lista antigua, el plugin vuelve a validar la ruta antes de escribir. Entrega create-only: guardar ledger, leer archivo, comparar contenido, ACK. Una confirmación describe esa verificación en ese instante; no prueba que la nota siga sin cambios posteriormente.

Estados: `queued → delivered | conflict | expired`, con `queued ↔ blocked` al retirar/restaurar permisos antes de caducar. Los terminales no se pueden cambiar. `consultar_estado` nunca inventa una entrega ni ofrece el contenido. Los tokens se devuelven una vez, guardando sus hashes en el relay. Con DATABASE_URL hay persistencia de clientes OAuth, emparejamientos, colas y recibos tras reiniciar. Sin DATABASE_URL se utiliza memoria efímera solo en desarrollo. Las credenciales de renovación y su historial de hashes también se conservan. Los registros DCR no caducan automáticamente (máximo 1.000), porque ChatGPT los conserva para futuras autorizaciones. No hay garantías de alta disponibilidad ni soporte para múltiples réplicas.

El SQL inicial está en relay/sql/001_relay_snapshot.sql. Ejecutar una vez sobre una base **dedicada** (sin abrir permisos de acceso públicos), configurar DATABASE_URL con la URL interna de Render y REQUIRE_DURABLE=true. El almacenamiento JSONB por snapshot está diseñado solo para **una instancia** y pequeños volúmenes beta; se debe migrar a transacciones por registro y controles de concurrencia antes de escalar. La retención del contenido pendiente continúa limitada por el código y el TTL. El proyecto nunca debe compartir credenciales con otras bases o servicios.

Retención: contenido pendiente hasta 24h; contenido de entregas/conflictos borrado al ACK. Timer de limpieza cada segundo. Metadatos/clave de idempotencia hasta 48h desde creación; dispositivo 7 días sin renovar; familia OAuth hasta 30 días. No se registran cuerpos en la aplicación. El operador del host puede leer memoria y tráfico después de TLS: usar datos de prueba. Proteger el acceso a diagnóstico, crash dumps y observabilidad. El cliente Obsidian no envía notas preexistentes; la comprobación por lectura queda local.

Límites: 100 bandejas, 100 jobs retenidos por bandeja, 50 carpetas, 60.000 caracteres por nota (además del máximo de 128 KiB del JSON), request 140.000 bytes, 16 MiB de contenido pendiente por instancia, 120 requests/minuto por dispositivo autenticado; rutas anónimas con límites separados por dirección, headers 16 KiB y timeout de request 15s. El rate limit no sustituye un control perimetral frente a abuso público distribuido. Si un proxy agrupa todas las conexiones bajo una IP, comparte el cupo; esta beta es para grupos pequeños. Sin logging de contenido ni secretos.

La metadata OAuth soporta DCR y clientes públicos; no anuncia CIMD. El flujo de usuario OB-ChatGPT fue comunicado como funcional por su propietario. La renovación natural de cada cliente y la matriz física de iPhone siguen pendientes de registro; véase COMMUNITY.md.


## Fallos y operación segura

Los cambios de estado se serializan. El snapshot se copia al guardarlo y se
restaura al último confirmado si falla la escritura; no se confirma una entrega
no persistida. Se responde 503 a la operación fallida y health indica degraded
hasta una escritura correcta. Se reintenta guardar tras 5 segundos. Solo la contención del bloqueo durante la carga inicial se reintenta automáticamente durante un máximo de 120 segundos (cada 250 ms). Mientras tanto, /health y las operaciones responden 503 sin bloquear la cola HTTP. Otros errores iniciales siguen fallando de forma cerrada.
Las pruebas locales usan un almacén con fallos inyectados; el checklist exige
además PostgreSQL real. La sesión mantiene un advisory lock exclusivo: una sucesora espera ese bloqueo sin cargar ni escribir el snapshot y continúa cuando se libera. Si se pierde la conexión y su lock, el relay devuelve 503 hasta reiniciar; nunca se reconecta silenciosamente con un snapshot antiguo. Sigue sin soportar escalado horizontal.

SIGTERM/SIGINT dejan terminar las peticiones en curso antes de cerrar el almacén y liberar su bloqueo. Configura el tiempo de parada para permitir ese cierre. El operador debe usar una estrategia de parada/arranque o drenaje que permita terminar al propietario anterior: un despliegue que mantenga indefinidamente la instancia anterior hasta que la nueva pase /health crea un bloqueo de despliegue. Con un drenaje TCP puede haber respuestas 503 breves mientras la instancia antigua termina; no se garantiza cero interrupción. No cambies de emisor PUBLIC_ORIGIN reutilizando una base con grants activos: las credenciales nuevas quedan vinculadas a su emisor original.

Por defecto se ignora X-Forwarded-For. Activa TRUST_PROXY=true únicamente detrás
de un proxy controlado que reemplace esa cabecera y bloquee el acceso directo.
El límite en memoria no protege por sí solo frente a ataques distribuidos.
El operador debe publicar su política de privacidad y retención de backups.
Nunca reutilizar infraestructura, credenciales o base de la edición privada.

`node relay/smoke.mjs https://TU-RELAY` hace una prueba externa sintética que
crea y revoca una bandeja. Requiere autorización del operador; no sustituye una
prueba en ChatGPT/Obsidian reales. No se ha ejecutado contra servicios en esta revisión.

## Prueba reproducible con PostgreSQL real

`npm run test:postgres` es una prueba explícita separada. Exige
TEST_ADMIN_DATABASE_URL y TEST_DATABASE_URL apuntando al mismo servidor loopback
y a una base desechable cuyo nombre empiece por chatgpt_inbox_test_. El rol del
relay debe empezar por relay_test_. Nunca usar una base del servicio privado.
`node tools/prepare-postgres-test.mjs` crea esa base nueva, aplica la migración y
concede al rol de ejecución solo USAGE del esquema y SELECT/INSERT/UPDATE de la
tabla. Se requiere una cuenta administradora local solo para preparar y provocar
fallos en la prueba; el relay no la recibe. Las URLs se pasan por entorno, nunca
se imprimen. Un servidor/rol/base existentes provocan error, no se reutilizan.

La prueba detiene bruscamente procesos del relay, comprueba restauración de
emparejamientos/códigos/tokens/colas/recibos, deniega escrituras SQL, prueba la
segunda instancia y elimina una conexión real. El workflow Community incluye
PostgreSQL 18 local como servicio CI; no se ha ejecutado aún en GitHub.

## Optional connection-test protocol in 0.4.4

Update the relay separately from the Obsidian plugin to enable the new test button. No hosted deployment is performed by a plugin update. Existing `/plugin/poll` and `/plugin/receipt` clients remain compatible. Poll responses additionally contain aggregate `counts.queued`, `counts.blocked` and `writerConnected`; the last flag means an authorized client grant is present, not proof of a particular client's tool call.

`POST /plugin/test` requires the device's plugin Bearer credential. Its body is `{key,path}`, with a `connection-test-` retry key and an exact synthetic filename `Prueba de conexión-<key>.md` inside the currently authorized folder. Content is fixed by the server; callers cannot supply note contents. It returns only the normal receipt. The existing poll → create-only write → verified receipt path handles delivery. Retry keys and payload signatures are device-scoped; another path or a non-test request using the key is rejected. Test requests share normal queue/byte limits, TTL, content removal on confirmation and durable rollback behavior, plus a separate rate limit of 30 requests per minute per device. No OAuth access/refresh tokens are returned to the plugin.

An older server returns 404 for the optional test route; the 0.4.4 UI explains that its operator must update the relay while ordinary reception remains usable. No production relay is certified or updated by the local desktop acceptance test.
