# 009 — Acordeones de Ayuda, Privacidad y Términos: animación corta con salida y sin el flag obsoleto

- **Status**: DONE
- **Commit**: bc6f0c7
- **Severity**: LOW
- **Category**: Easing & duration / Performance
- **Estimated scope**: 3 ficheros, ~6 líneas cada uno

## Problem

Las tres pantallas abren y cierran sus secciones con `LayoutAnimation` y el preset `easeInEaseOut`, y activan un flag experimental de Android:

```ts
// app/help-center.tsx:22-24  (igual en app/privacy.tsx:21-23 y app/terms.tsx:21-23)
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

// app/help-center.tsx:106-109  (igual en app/privacy.tsx:55-58 y app/terms.tsx:48-51)
const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => (prev === id ? null : id));
};
```

1. La app usa la Nueva Arquitectura (`app.json:23` `"newArchEnabled": true`), donde `setLayoutAnimationEnabledExperimental` no hace nada y muestra un aviso en consola.
2. El preset `easeInEaseOut` dura 300ms y arranca lento: al tocar una pregunta, el texto tarda en empezar a aparecer.

## Target

```ts
const ACCORDION_ANIM = LayoutAnimation.create(
    200,
    LayoutAnimation.Types.easeOut,
    LayoutAnimation.Properties.opacity,
);

const toggle = (id: string) => {
    LayoutAnimation.configureNext(ACCORDION_ANIM);
    setExpanded((prev) => (prev === id ? null : id));
};
```

- 200ms, curva de salida (empieza rápido), el texto nuevo aparece con fundido y las filas de abajo se desplazan.
- Sin el bloque `UIManager.setLayoutAnimationEnabledExperimental`.

## Repo conventions to follow

- Constantes de módulo en MAYÚSCULAS (p. ej. `INK`, `MUTED` en `app/help-center.tsx:26-30`). Pon `ACCORDION_ANIM` junto a ellas.

## Steps

Para cada fichero (`app/help-center.tsx`, `app/privacy.tsx`, `app/terms.tsx`):

1. Borra el bloque `if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) { … }`.
2. Quita `UIManager` del import de `react-native`. Quita `Platform` **solo** si ya no se usa en el fichero (búscalo antes).
3. Añade la constante `ACCORDION_ANIM` del **Target** a nivel de módulo, debajo de las constantes de color.
4. En `toggle`, cambia `LayoutAnimation.Presets.easeInEaseOut` por `ACCORDION_ANIM`.

## Boundaries

- NO cambies la estructura del acordeón (render condicional `{open ? … : null}`), ni los estilos, ni los textos.
- NO migres a Reanimated: `LayoutAnimation` funciona en la Nueva Arquitectura y aquí basta.
- NO añadas dependencias.

## Verification

- **Mechanical**: `npm run typecheck`; `grep -rn "setLayoutAnimationEnabledExperimental" app` no devuelve nada.
- **Feel check** (dev build en Android e iPhone):
  - En Ayuda, tocar una pregunta: la respuesta aparece enseguida con un fundido corto y las preguntas de abajo bajan con suavidad.
  - Tocar otra pregunta con una abierta: una se cierra y la otra se abre a la vez, sin saltos.
  - Tocar varias muy rápido: nada se queda a medias ni parpadea.
  - Repetir en Privacidad y en Términos.
  - En la consola de Metro no aparece el aviso de `setLayoutAnimationEnabledExperimental`.
- **Done when**: las tres pantallas usan `ACCORDION_ANIM` y no queda el flag experimental.
