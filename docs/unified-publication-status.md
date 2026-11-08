# Publicación del feed único — 8 de noviembre de 2026

Autorización recibida: publicar ahora con Madrid, dejando Ticketmaster para más adelante. No se ha modificado `main` ni hecho merge.

## Backend publicado y verificado

- Aplicadas y registradas `20261108120000_confirmed_social_feed.sql` y `20261108180000_consolidate_legacy_event_groups.sql` en `nixeproyzxvqzyrvsxcx`.
- Importador Edge actualizado, con JWT de pasarela y secreto interno conservados. Primera sincronización real: HTTP 200, 359 registros aceptados de 1.385 registros de origen. La tarea diaria sigue activa.
- Se consolidaron tres duplicados heredados. Las seis filas afectadas no tenían integrantes ni mensajes en producción. La migración también se probó con integrantes, chat, denuncias e historial sintéticos para verificar que los conserva.
- Lectura pública comprobada a las 17:12 UTC: 353 eventos publicables, cero pares duplicados; todos los de la página tienen hora y ubicación confirmadas. Ficha con coordenadas, filtros de subcategoría y resúmenes sin identidades para invitados verificados por HTTP. El recuento baja conforme comienzan las actividades.
- Madrid habilitado; Ticketmaster deshabilitado. No se ha solicitado ni utilizado una clave de Ticketmaster.

Evidencia: [verificación pública](data/unified-live-verification-2026-11-08.json) e [informe de publicación](data/unified-production-deployment-2026-11-08.json).

## Actualización móvil preparada, todavía sin publicar

Los dos juegos de bundles se exportaron correctamente y se cargaron los mapas de recursos, pero la subida de los bundles fue rechazada antes de crear un grupo nuevo. Diagnóstico de red limitado a dominio/estado: HTTP 403, `Domain forbidden`, al hacer POST a `update-assets-upload-production.storage.googleapis.com`. No es un rechazo de Apple/Google ni un problema con las claves de Madrid o Ticketmaster.

El dominio exacto se guardó en el borrador de configuración; la herramienta confirmó `status=saved` y `requires_publish=true`. Guardar el borrador no aplica la política de red al entorno actual. El propietario debe revisar/guardar el cambio y publicar el entorno. No se debe repetir la subida hasta comprobar el dominio permitido en un estado vigente y con política aplicada.

| Binarios destinatarios | Runtime OTA | Código | Dependencias nativas de la exportación |
| --- | --- | --- | --- |
| Apps públicas 1.0.10 | 1.0.0 | `eaf8c1c`, rama `release/unified-feed-runtime-1.0.0` | Conserva las del binario existente: view-shot 5.1.1 y expo-asset 12.0.13 |
| Binarios nuevos 1.0.11 | 1.0.11 | Feed `fbe22f8`, rama `feature/unified-social-feed` | view-shot 4.0.3 y expo-asset 12.0.14 |

La variante antigua conserva el mismo código de funcionalidad y usa las versiones JS originales de sus módulos nativos. Se verificaron los binarios de Expo Android versionCode 19 e iOS build 1.0.19, SDK 54 y React Native 0.81.5. La variante se exporta desde un checkout y dependencias independientes. No se envía el wrapper de view-shot 4 a los binarios anteriores. Las actualizaciones se seleccionan por runtime, aunque comparten el canal `production`.

## Retomar cuando se aplique el acceso de red

Los bundles están guardados bajo `/workspace/NEXO/builds/ota/unified-feed-2026-11-08/`, ignorados por Git. El informe contiene sus SHA-256. No volver a aplicar las migraciones ni recompilar: ya están listas ambas variantes.

Desde `/workspace/NEXO-legacy-ota`, publicar primero la variante de las apps ya instaladas:

```sh
npm exec --yes --package=eas-cli@27.5.0 -- eas update \
  --channel production --environment production --platform all \
  --message "Feed único: eventos confirmados de Madrid para apps actuales" \
  --input-dir /workspace/NEXO/builds/ota/unified-feed-2026-11-08/runtime-1.0.0 \
  --skip-bundler --non-interactive --json
```

Desde `/workspace/NEXO`, publicar la variante de los binarios nuevos:

```sh
npm exec --yes --package=eas-cli@27.5.0 -- eas update \
  --channel production --environment production --platform all \
  --message "Feed único: eventos confirmados de Madrid, integrantes y mapas" \
  --input-dir /workspace/NEXO/builds/ota/unified-feed-2026-11-08/runtime-1.0.11 \
  --skip-bundler --non-interactive --json
```

Usar el checkout indicado en cada comando: `--skip-bundler` también lee su configuración para asignar el runtime. Verificar después los grupos reales, sus dos plataformas y el manifiesto servido por `u.expo.dev` para cada runtime. Solo entonces marcar la actualización móvil como publicada y dar instrucciones para reabrir la app.

## Validación

Suite de aplicación aprobada (16 archivos), 222 comprobaciones SQL en diez archivos, TypeScript de ambas variantes y exportaciones Hermes Android/iOS de ambas variantes. Las pruebas manuales en dispositivos se omiten por petición del usuario. Las nuevas compilaciones y envíos a tiendas de 1.0.11 siguen siendo operaciones separadas; los intentos OTA descritos aquí no han creado versiones en tiendas.
