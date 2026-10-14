# Guardado compartido

`shared-state-merge.js` combina la última versión común, la edición local y el estado actual de Supabase. `shared-sync.js` sustituye el guardado que recargaba y descartaba cambios al detectar otra versión.

- Las escrituras siguen condicionadas por `version`; si otro cliente gana la carrera se vuelve a leer y combinar (máximo cinco intentos antes de reprogramar).
- Se combinan campos independientes y filas con identidad inequívoca. Un ramo incluye su composición y su catálogo de precios: dos cambios al mismo ramo requieren elegir una versión completa. No se suman composiciones ni se deduce la identidad por posición.
- Los campos superiores que duplican la semana activa no se comparan como datos independientes. La selección de semana y la vista del usuario se conservan.
- Las ediciones hechas mientras la petición está en curso se conservan y se programan para el siguiente guardado.
- Los conflictos mantienen ambas versiones en IndexedDB y muestran un diálogo. Cerrar el diálogo deja el guardado pendiente. Una resolución se vuelve a comprobar contra la versión más reciente del servidor.
- El botón **Copias de recuperación** permite descargar los estados anteriores a cargas y conflictos. Las copias son locales a este navegador, están filtradas por usuario y no sustituyen a un backup del servidor. Borrar los datos del navegador también borra estas copias.
- Un diario por pestaña conserva base, versión y cambios pendientes para la recuperación al recargar. Una copia antigua sin base conocida se conserva para descarga, pero no se mezcla automáticamente: no es posible distinguir cambios de datos obsoletos sin una base.
- La web HTTPS no carga ni autoguarda mediante OneDrive. Los mensajes del editor describen el almacenamiento compartido.
- Se comprueban novedades cada 15 segundos cuando la vista está inactiva y sin cambios pendientes. No se refresca un editor abierto ni un borrador de producción.

## Validación

`node --test *.test.js`

`node shared-sync.browser-test.cjs` (requiere Playwright y Chrome; `AQ_TEST_BROWSER` permite elegir otro canal instalado).

La prueba de navegador usa dos contextos aislados, la aplicación completa, IndexedDB real y un servidor simulado en memoria. Todas las peticiones externas se bloquean; no usa ni modifica datos reales de Supabase. Comprueba guardados simultáneos, diálogo de conflicto, resolución explícita y recuperación tras recargar.

## Activación y recuperación

Ambas personas deben cargar la versión actualizada. Antes de recargar una pestaña antigua con trabajo pendiente, exportar su copia JSON. La actualización no puede recuperar información ya descartada por la versión anterior. Para recuperar un ramo, conservar la copia del ordenador donde se editó y recuperar únicamente ese producto después de revisar su composición; no reemplazar todo el estado compartido por un backup antiguo.
