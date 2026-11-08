# Adjuntos originales — receptor 0.5.0

## Alcance

Fotos, PDF, documentos, hojas de cálculo, audio, vídeo y cualquier archivo que pueda obtenerse como bytes por una vía autorizada. El receptor conserva el archivo; no promete que Obsidian pueda previsualizar todos los formatos. No ejecuta ni descomprime archivos.

Máximo por solicitud: 32 archivos, 20 MiB en total, fragmentos de hasta 256 KiB y manifiesto de 128 KiB. Las carpetas se crean si están autorizadas. No escribir en carpetas ocultas, configuración de Obsidian o rutas absolutas. No sobrescribe un destino distinto. Si supera el límite, informa o divide archivos independientes en varias solicitudes; no recortes ni recomprimas originales sin indicarlo.

## Preparación

El script [prepare-attachments.py](tools/prepare-attachments.py) prepara el manifiesto y los fragmentos base64 desde bytes locales; no accede a tokens ni a la red. Se usa cuando el entorno puede leer los archivos realmente adjuntados. Su entrada JSON es:

~~~json
{"id":"adjuntos-id-unico","files":[{"source":"/ruta/original.png","path":"Carpeta/Adjuntos/original.png"}],"note":{"path":"Carpeta/Nota.md","content":"# Foto\n\n![[Carpeta/Adjuntos/original.png]]\n"}}
~~~

Ejecuta el script con rutas del entorno disponibles, no del iPhone que no puedas leer. El campo note es opcional. Los destinos son relativos a Mi Biblioteca. Genera enlaces completos de Obsidian: `![[ruta/imagen.png]]` para incrustar o `[[ruta/archivo.pdf|Abrir archivo]]` para enlazar.

## Subida por la conexión GitHub

Repositorio privado `<usuario/repositorio-privado-configurado>`, rama `main`. Todos los datos de los adjuntos enviados quedarán en su historial; conserva la autorización del usuario y evita transferir secretos o contenido ajeno a su petición.

1. Por cada fragmento único, usa GitHub create_blob con encoding=base64 y los bytes preparados. Verifica que su SHA coincide con la preparada. No imprimas el contenido base64 en el chat ni lo transcribas como texto de la nota.
2. Un blob suelto no es una entrega duradera: inclúyelo en un árbol Git bajo `chatgpt-inbox/attachments/<id>/<sha>.blob`.
3. Obtén HEAD de main y su árbol. Crea un árbol basado en él, conservando todo lo existente, que incluya los blobs y `chatgpt-inbox/requests/<id>.json` con el manifiesto. Crea el commit hijo del HEAD observado y actualiza main sin force, con expected_sha. Nunca crees un árbol vacío que elimine el repositorio anterior.
4. Si cambia HEAD, lee el nuevo HEAD y reconstruye el árbol con los mismos archivos sobre él; no fuerces la rama ni sobrescribas una solicitud ya distinta. Un reintento de la misma solicitud mantiene exactamente ID, manifiesto y blobs.
5. Solo confirma solicitud enviada cuando main apunte al commit que contiene el manifiesto y los blobs. Si alguna capacidad de subida falta, explica la limitación; no sustituyas la imagen por texto ni uses otro destino no autorizado.

## Manifiesto versión 3

~~~json
{"version":3,"id":"adjuntos-id-unico","operation":"attachments","files":[{"path":"Carpeta/Adjuntos/original.png","size":1234,"sha256":"<SHA-256 de los bytes completos>","chunks":[{"sha":"<SHA Git del blob de 40 hex>","size":1234}]}],"note":{"path":"Carpeta/Nota.md","content":"# Foto\n\n![[Carpeta/Adjuntos/original.png]]\n"}}
~~~

Todos los campos mostrados en cada archivo son obligatorios. chunks está ordenado y sus tamaños suman size. Un archivo vacío tiene chunks=[] y SHA-256 del contenido vacío. SHA-256 siempre hexadecimal minúsculo de los bytes originales, sin convertirlos a UTF-8. MIME no forma parte del manifiesto. note es opcional; solo path/content, sin marcadores reservados.

## Recepción y recibos

Al abrir Obsidian, el receptor descarga los blobs del mismo repositorio, reconstruye los bytes, verifica tamaño y SHA-256, guarda con createBinary y comprueba los bytes escritos. La nota con enlaces se crea después. Si existe un archivo distinto, se conserva y se registra Conflicto. Un fallo de red deja la solicitud pendiente y permite reanudar sin duplicar los adjuntos ya verificados.

La bandeja muestra Adjuntos recibidos. El recibo local `attachmentLedger[id].state === "applied"` confirma el procesamiento en ese receptor; pending/conflict no son entrega completa. Si la nota de enlaces entra en conflicto después de guardar los archivos, el detalle lo indica y no se afirma éxito completo. El receptor sigue usando un token de solo lectura y no sube recibos automáticamente a GitHub.

Para la primera prueba real, verificar en el iPhone la versión 0.5.0, que se ve la imagen y que abre el archivo. No afirmar prueba integral por resultados de mocks o por aceptar GitHub el commit.

## Edición y papelera (version 2)

Edición: `{"version":2,"id":"<id-nuevo>","operation":"update","path":"<ruta.md>","expectedHash":"<sha256-del-texto-anterior>","content":"<texto-nuevo-completo>"}`.

Papelera: `{"version":2,"id":"<id-nuevo>","operation":"trash","path":"<ruta.md>","expectedHash":"<sha256-del-texto-anterior>"}`.

El hash es del UTF-8 exacto, conservando saltos, espacios y Unicode, sin el sufijo de metadatos de Inbox. Si se conoce el contenido exacto enviado originalmente, se calcula directamente sobre ese texto. No inventar una versión anterior: si cambió, el receptor conserva la nota y registra Conflicto. Cada solicitud nueva usa otro ID; los reintentos mantienen todo el JSON sin cambios. El permiso de cambios debe estar activado. Las copias se recuperan mediante la bandeja, sin sobrescribir notas actuales.
