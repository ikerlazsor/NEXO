# Comprobación de la fuente municipal · 7 de noviembre de 2026

El nuevo entorno tiene aplicados los accesos de red solicitados. Se han leído la ficha oficial, sus descargas, condiciones de uso y condiciones generales del Ayuntamiento:

- [Dataset oficial](https://datos.madrid.es/dataset/206974-0-agenda-eventos-culturales-100).
- [Condiciones de uso](https://datos.madrid.es/pages/condiciones-de-uso).
- [Condiciones generales](https://datos.madrid.es/pages/condiciones-generales-ayuntamiento-de-madrid).

La ficha declara actualización diaria, última actualización el **6 de noviembre de 2026** y **Creative Commons Attribution 4.0 International (CC BY 4.0)**. Las condiciones permiten reutilización comercial/no comercial, exigen citar origen y fecha disponible, preservar metadatos y sentido de la información y no sugerir patrocinio del Ayuntamiento.

La ficha del evento incluye ahora enlaces al dataset/licencia y aclara que Nexo normaliza los datos y usa portadas ilustrativas propias de su catálogo. «Fuente consultada» identifica el momento de sincronización; no se presenta como una fecha original de modificación que el JSON no proporciona por evento.

## Resultado observado

El JSON oficial descargado tiene 1.443 registros. La normalización produjo 1.385 actividades futuras o en curso, 58 caducadas, cero rechazadas y cero duplicadas. Hay registros en las seis categorías Nexo: 608 Descubrir, 667 Showtime, 12 Picoteo, 37 Ocio, 54 Aire libre y 7 Deportes. Son resultados de esta descarga; cambiarán con las actualizaciones del proveedor.

Se verificó el esquema real (`@graph`, IDs, título/descripción, gratuidad/precio, fechas, horario, exclusiones, localización y organización). La descarga contiene programas permanentes y rangos de varios días: no deben interpretarse como sesiones individuales reservables. Las horas sin offset no se convierten a UTC inventando un instante. Se conserva el texto de horario cuando existe; faltan ubicaciones en algunos registros.

Se ejecutó la RPC de sincronización en **Supabase local** con este catálogo, dentro de una transacción: importó los 1.385 registros y la lectura anónima devolvió su primera página de 30. La transacción se revirtió al terminar: no se activó el proveedor ni se escribió en producción. Esta prueba valida formato, constraints y primera página, no constituye revisión manual de cada evento ni prueba de todos los calendarios recurrentes/excepciones.

[Metadatos, hash SHA-256 y recuentos](data/madrid-source-review-2026-11-07.json). El JSON completo permanece como artefacto local de comprobación; no se añade al repositorio.

## Qué queda para el público

Actualización posterior a la autorización del usuario: se conservaron los días excluidos, se activó el proveedor en producción y se comprobó la tarea diaria real con 1.385 actividades. El informe anterior corresponde a la primera comprobación local y su rollback. La versión móvil sigue pendiente de distribución: ver [estado actualizado](madrid-events-launch.md). No se ha publicado OTA ni una versión en tiendas.
