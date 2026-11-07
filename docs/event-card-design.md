# Tarjetas de agenda alineadas con los planes

- Planes y eventos comparten `components/planCardActions.ts`: radio de 14, tamaño, padding, tipografía, azul de «Me apunto» y verde de participación. Se reutilizan los estilos existentes sin cambiar las acciones de los planes.
- Tarjetas de eventos con borde, panel de contenido, altura de portada editorial y metadatos más próximos a los planes. En el feed respetan su padding existente, evitando un segundo margen horizontal que las estrechaba.
- Se conserva la variante horizontal de Para ti y la editorial de Agenda. No vuelve la frase introductoria, las estrellas ni el chip de fecha sobre la imagen.
- La atribución al Ayuntamiento pasa al pie junto al botón, diferenciada de un anfitrión de Nexo. No se inventan avatares de organizadores o participantes.
- El catálogo completo de las **6 categorías y 30 subcategorías** está disponible. Una nueva regresión comprueba para cada pareja que todas sus fotos locales son seleccionables; las fotografías siguen siendo apropiadas para la clasificación del evento.
- La vista previa web tiene «Ver todas las subcategorías (30)». Es solo un catálogo sintético de diseño, nunca una lista de eventos reales.

Validación: TypeScript sin errores; ESLint sin errores (72 advertencias previas); suite unitaria completa aprobada, cinco casos específicos de clasificación/portadas; Chromium comprueba ambas variantes, las 30 subcategorías y ancho móvil. Bundles Android/iOS generados. La prueba de importación del catálogo municipal real se describe en `madrid-source-validation.md`.
