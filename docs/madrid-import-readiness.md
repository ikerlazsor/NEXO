# Revisión del importador de Madrid para lanzamiento

Actualización del 7 de noviembre: el acceso ya funciona, se han consultado el catálogo y la licencia municipales y se ha probado la carga real en una transacción local revertida. Ver [evidencia de fuente](madrid-source-validation.md). El proveedor sigue desactivado y no se ha escrito en producción; quedan las pruebas de calendarios y el despliegue de [activación pública](madrid-events-launch.md).

Se han corregido defectos reproducibles antes de utilizar un catálogo real:

- IDs booleanos, objetos y listas ya no se convierten en identificadores de texto plausibles.
- Coordenadas booleanas o listas ya no se convierten silenciosamente a cero.
- Horarios locales malformados ya no se presentan como eventos con fecha válida y hora desconocida.
- Un estado de cancelación con espacios o mayúsculas se conserva como cancelación.
- El fetcher verifica el tipo JSON declarado y sigue limitando el cuerpo a 8 MiB aunque el servidor omita `content-length`. Las redirecciones siguen rechazadas.

## Evidencia de una revisión de fuente

El mismo comando de dry run puede guardar un informe local nuevo, sin acceder a Supabase:

```sh
npm run events:dry-run -- --report=/tmp/madrid-review.json
```

El informe registra URL exacta, fecha de descarga, bytes y SHA-256 del cuerpo descargado. Añade recuentos de registros aceptados, rechazados, caducados, duplicados, campos ausentes y categorías, con una muestra de hasta diez eventos normalizados.

Para revisar un fichero previamente descargado:

```sh
npm run events:dry-run -- --file=/ruta/agenda.json --report=/tmp/madrid-file-review.json
```

En ese caso el informe lo identifica como `local-file`: **no se considera prueba de una descarga oficial**. El informe no sobrescribe archivos existentes. Se escribe incluso si después el snapshot se rechaza, para facilitar el diagnóstico de campos no compatibles.

Ambos informes mantienen `licenseVerified: false` y `currentSourceContractVerified: false`. La revisión humana debe comprobar los términos vigentes, la atribución, las imágenes por separado, las sesiones recurrentes, cancelaciones y normalización de fechas. El informe no habilita permisos ni aprueba al proveedor automáticamente.

El comando con `--apply` conserva la opt-in explícita y las validaciones de revisión en servidor. Continúa rechazando el hostname de producción actual y URLs de Supabase con credenciales o rutas inesperadas. No se ha preparado un atajo para publicar datos sin revisar.

## Validación

Siete nuevas pruebas de regresión del importador pasan; también pasan las cinco existentes de normalización, las dos del fetcher y las ocho de recomendaciones/importación/mezcla. Las pruebas unitarias usan datos sintéticos y fetch simulado. Además, se ha revisado la descarga oficial y la RPC ha importado sus 1.385 actividades aceptadas en Supabase local dentro de una transacción revertida.
