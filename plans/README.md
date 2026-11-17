# Planes de animación — Nexo

Auditoría de movimiento hecha sobre el commit `bc6f0c7` (rama `feat/curated-social-events`) con las guías *improve-animations* y *animate-expo*. Cada plan es autocontenido: incluye fragmentos del código actual, valores exactos, pasos, límites y cómo comprobar la sensación en dispositivo.

## Planes

| # | Título | Gravedad | Estado | Build nativa |
| --- | --- | --- | --- | --- |
| [001](001-motion-tokens-y-scheduleonrn.md) | `lib/motion.ts` con curvas compartidas y `runOnJS` → `scheduleOnRN` | LOW (base) | DONE | No |
| [002](002-mapa-cierre-sin-ease-in.md) | Cerrar el panel del mapa sin `Easing.in` | HIGH | DONE | No |
| [003](003-pressscale-sin-vibracion-por-defecto.md) | `PressScale` sin vibración por defecto | HIGH | DONE | No |
| [004](004-plancard-presion-reanimated.md) | Presión de `PlanCard` con Reanimated, sin rebote | MEDIUM | DONE | No |
| [005](005-toast-gesto-reanimated.md) | Aviso dentro de la app que sigue el dedo | MEDIUM | DONE | No |
| [006](006-filtros-sheet-con-muelle.md) | Panel de filtros con muelle y velocidad | MEDIUM | DONE | No |
| [007](007-chat-teclado-keyboard-controller.md) | Chat sincronizado con el teclado real | MEDIUM | TODO | **Sí** (nueva dependencia) |
| [008](008-movimiento-reducido.md) | Respetar "Reducir movimiento" | MEDIUM | DONE | No |
| [009](009-acordeones-layoutanimation.md) | Acordeones de Ayuda/Privacidad/Términos | LOW | DONE | No |
| [010](010-skeleton-sin-salto-de-color.md) | Skeleton sin salto de color | LOW | DONE | No |
| [011](011-responder-vibrar-al-cruzar-umbral.md) | Responder: vibrar al cruzar el umbral | LOW | DONE | No |
| [012](012-ios-120fps.md) | Confirmar 120fps en iPhone ProMotion | LOW | TODO | **Sí** |

## Orden recomendado

1. **001** primero: crea `lib/motion.ts` y migra `runOnJS`; 002, 004, 005, 006 y 011 lo importan.
2. **002** y **003**: los de más impacto por menos esfuerzo (unas pocas líneas cada uno).
3. **004**, **006**, **005**: tocan lo que más se usa (feed, filtros, avisos).
4. **008**: después de 004 y 005, que ya incluyen su propio movimiento reducido.
5. **009**, **010**, **011**: pulido; independientes entre sí.
6. **007** y **012** juntos, cuando toque sacar una build nativa nueva (no se pueden publicar con `eas update`). 007 añade `react-native-keyboard-controller` y requiere confirmación.

## Dependencias

- 002, 004, 005, 006, 011 → dependen de **001**.
- 008 no toca ficheros de 004, 005 ni 010 (cada uno gestiona su propio movimiento reducido).
- 006 y 008 editan `app/(tabs)/index.tsx` en zonas distintas (`:240-316` frente a `:341-350` y `:444-447`): ejecútalos uno detrás de otro, no en paralelo.
- 001, 008 y 011 editan `components/ChatMessageRow.tsx`: en ese orden.
- 001 y 002 editan `components/FeedMapHost.tsx`: en ese orden.

## Revisado y correcto (no hace falta tocar)

- Cambio de pestaña al pulsar: sin animación (`setPageWithoutAnimation`, `lib/createPagerTabNavigator.tsx:83`). Deslizar entre planes y chats es una decisión de producto.
- Transiciones entre pantallas: nativas del stack (`app/_layout.tsx`).
- `PressScale`: escala 0.975, 55/110ms, respeta movimiento reducido.
- Deslizar para responder en el chat: corre en el hilo de UI.
- Celebraciones (lluvia de corazones, splash): dentro del margen para momentos poco frecuentes.
