# Actualización para los binarios ya distribuidos

Esta rama de publicación conserva el código del feed de `fbe22f8` y adapta únicamente la configuración de distribución al runtime **1.0.0** de los binarios públicos **1.0.10**.

Verificados en Expo: Android `b3959966-8de7-49aa-a0bc-4371feea9caa` (versionCode 19) e iOS `8498ab38-6636-49cb-85fe-5082ab064f26` (build 1.0.19), ambos basados en `36b9277` y Expo SDK 54. Se mantienen React Native 0.81.5 y todas sus dependencias nativas originales. Se restauran las versiones originales de `react-native-view-shot` (5.1.1) y `expo-asset` (12.0.13), incluido el código JS que se exporta, evitando servirles el wrapper de otra versión nativa. `country-state-city` es solo JavaScript.

La copia de dependencias del entorno de exportación es independiente de la rama principal del cambio. No aplica el parche Java de marcadores al binario existente: una OTA no altera código nativo. El contrato JS de mapas es el mismo. No se han realizado pruebas en dispositivos reales.

Esta rama no debe fusionarse como configuración de nuevos binarios. La rama `feature/unified-social-feed` conserva la versión/runtime 1.0.11 y sus versiones compatibles con los binarios nuevos. Se publica cada variante por separado en el canal `production`, donde Expo selecciona la correspondiente al runtime instalado.
