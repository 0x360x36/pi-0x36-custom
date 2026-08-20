---
description: commitea cambios del repositorio en espanol siguiendo el estandar de commits convencionales
---

NO ESTA PERMITIDO CREAR RAMAS NUEVAS, SOLO COMITEA CAMBIOS EN LA RAMA PRINCIPAL

Audita detalladamente los cambios pendientes en el repositorio luego genera un commit, asegurando que cada commit siga la convención de Commits Convencionales como en el siguiente documento:

## Estructura base

Todo commit debe comenzar con un tipo, seguido opcionalmente por un ámbito, luego `:` y un espacio, y después una descripción corta del cambio.[1]
El cuerpo va después de una línea en blanco, puede tener varios párrafos, y las notas al pie van después de otra línea en blanco.[1]

Plantilla:

```text
<tipo>[ámbito opcional]: <descripción>

[cuerpo opcional]

[nota(s) al pie opcional(es)]
```

## Cómo decidirlo

Usa `feat` cuando agregas una funcionalidad nueva, `fix` cuando corriges un bug, y otros tipos como `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `style` o `perf` cuando describen mejor la intención del cambio.[1]
Si el cambio rompe compatibilidad, debes indicarlo con `!` en el encabezado o con una nota al pie `BREAKING CHANGE:`, y ese tipo de cambio se relaciona con una versión MAJOR en SemVer.[1]

Flujo de decisión:

1. Identifica la intención principal del cambio: nueva funcionalidad, corrección, documentación, refactor, pruebas, build, etc.[1]
2. Decide si necesitas ámbito, por ejemplo `auth`, `api`, `ui`, `parser` o `lang`; el ámbito va entre paréntesis.[1]
3. Redacta una descripción breve y clara, inmediatamente después de `: `.[1]
4. Agrega cuerpo solo si necesitas contexto adicional.[1]
5. Agrega notas al pie si necesitas referencias, revisores o un `BREAKING CHANGE`.[1]

## Ejemplos del texto

Estos son los ejemplos del texto, ya ordenados por caso de uso.[1]

| Caso | Ejemplo |
|---|---|
| Cambio de ruptura en nota al pie | `feat: allow provided config object to extend other configs`<br><br>`BREAKING CHANGE: extends key in config file is now used for extending other config files` [1] |
| Cambio de ruptura con `!` | `refactor!: drop support for Node 6` [1] |
| Cambio de ruptura con `!` y nota al pie | `refactor!: drop support for Node 6`<br><br>`BREAKING CHANGE: refactor to use JavaScript features not available in Node 6.` [1] |
| Commit sin cuerpo | `docs: correct spelling of CHANGELOG` [1] |
| Commit con ámbito | `feat(lang): added polish language` [1] |
| Cuerpo multi-párrafo y múltiples notas al pie | `fix: correct minor typos in code`<br><br>`see the issue for details`<br><br>`on typos fixed.`<br><br>`Reviewed-by: Z`<br>`Refs #133` [1] |
| Revert recomendado | `revert: let us never again speak of the noodle incident`<br><br>`Refs: 676104e, a215868` [1] |

## Workflow práctico

Primero separa los cambios por intención, porque la especificación recomienda hacer múltiples commits si un cambio encaja en más de un tipo.[1]
Después redacta el encabezado con esta fórmula: `tipo(ámbito): descripción`, y solo agrega cuerpo o notas al pie cuando aporten contexto real.[1]

Workflow sugerido:

- Paso 1: Revisa qué cambió realmente en tu rama y agrupa por intención, por ejemplo bug, feature, docs o refactor.[1]
- Paso 2: Elige un solo tipo principal por commit; si mezclaste varias intenciones, sepáralas en varios commits.[1]
- Paso 3: Define el ámbito solo si aporta contexto útil, por ejemplo `api`, `auth`, `lang` o `parser`.[1]
- Paso 4: Escribe una descripción corta, específica y sin emojis.  
- Paso 5: Añade cuerpo si necesitas explicar el porqué, impacto o contexto del cambio.[1]
- Paso 6: Añade notas al pie para referencias como `Refs #133`, revisiones como `Reviewed-by: Z`, o ruptura con `BREAKING CHANGE:`.[1]
- Paso 7: Si rompiste compatibilidad, usa `!` o `BREAKING CHANGE:`; puedes usar ambos si quieres que quede más explícito.[1]

## Commit final

Si quieres terminar con un commit listo para usar, este workflow produce bien un mensaje como el siguiente, que respeta la especificación, usa ámbito, agrega cuerpo y evita emojis.[1]

```text
feat(auth): add passwordless login

Adds support for email-based one-time access codes.
Improves first-login flow for users without a stored password.

Refs #241
```

Si además ese cambio rompiera compatibilidad, podrías dejarlo así.[1]

```text
feat(auth)!: add passwordless login

Adds support for email-based one-time access codes.
Removes the previous mandatory password step from the login flow.

BREAKING CHANGE: clients must update the login integration because password submission is no longer required.
```

CONSIDERA SIEMPRE CREAR COMMITS EN ESPAÑOL
