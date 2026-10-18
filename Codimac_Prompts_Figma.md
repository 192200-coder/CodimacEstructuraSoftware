# Codimac · Prompts para Figma

Son 6 prompts pensados para pegarse **en orden**. El Prompt 0 fija el contexto y el sistema de diseño; los Prompts 1 a 4 piden las pantallas por rol; el Prompt 5 conecta los flujos. Si la herramienta tiene límite de texto, pega un prompt a la vez y confirma el resultado antes de pasar al siguiente.

Cada bloque de código es un prompt completo: copia solo lo que está dentro.

---

## Prompt 0 · Contexto y sistema de diseño (pegar primero)

```
Eres un diseñador de producto senior. Vas a diseñar la interfaz de CODIMAC, un sistema web de despacho logístico para una empresa que reparte materiales de construcción en Abancay, Apurímac (Perú). Es un proyecto académico: usa SOLO datos de ejemplo, nunca datos reales.

QUÉ HACE EL SISTEMA
Registra pedidos, controla el inventario (con reservas de stock) y propone la mejor secuencia de entregas para uno o varios clientes por reparto, considerando tiempo, distancia y combustible. El chofer confirma cada entrega parada por parada y el cliente consulta su propio estado.

ROLES Y PLATAFORMAS
- Despachador / almacén: web de escritorio (marco de 1440 px), navegación lateral.
- Administrador: web de escritorio (1440 px), navegación lateral.
- Chofer: celular (390 x 844 px), mobile-first, botones de al menos 48 px de alto.
- Cliente: celular (390 x 844 px), sin cuenta; solo ingresa el código del pedido.

ESTILO VISUAL
- Profesional, sobrio, de herramienta logística. Fondo claro, mucho espacio en blanco, bordes redondeados de 8 px.
- Color primario azul oscuro #1F3A5F, acento azul #2E5C8A, texto principal #1F2937, texto secundario #6B7280.
- Tipografía sans-serif legible (por ejemplo Inter). Alto contraste, pensado para usarse al sol en el celular.
- Tablas densas pero limpias en escritorio; en celular, una acción principal por pantalla.

COLORES DE ESTADO (cada estado debe llevar SIEMPRE un texto o ícono, no solo color)
- Gris (texto #6B7280, fondo #E5E7EB): Pendiente
- Ámbar (texto #B7791F, fondo #FDE9B5): En preparación
- Azul (texto #2563EB, fondo #CFE0F5): Listo / En camino
- Índigo (texto #4F46E5, fondo #D9D9F5): En ruta
- Verde (texto #15803D, fondo #CDEBD3): Entregado / Entregada
- Naranja (texto #C2570C, fondo #FCDDBF): Incidencia
- Rojo (texto #B91C1C, fondo #F6D0D0): Cancelado / No entregada

ESTADOS DE NEGOCIO
- Pedido: Pendiente → En preparación → Listo → En ruta → Entregado. También puede estar Cancelado.
- Parada de una ruta: Pendiente, En camino, Entregada, Incidencia, No entregada.
- El cliente ve solo tres estados: Registrado, En camino, Entregado.

LOCALIZACIÓN
Todo el texto de la interfaz en español (Perú). Moneda en soles (S/ 9,92), distancias en km, horas en formato de 24 horas.

COMPONENTES REUTILIZABLES QUE DEBES CREAR UNA SOLA VEZ
1. Distintivo de estado (pedido y parada) con los colores de arriba.
2. Banner de alerta con variantes: error, advertencia, aviso, información.
3. Tarjeta de alternativa de ruta (A, B, C) con orden de paradas, km, minutos, litros y costo.
4. Tarjeta de parada con número, cliente, dirección y estado.
5. Mapa con marcadores numerados y línea de ruta (puede ser un mapa estilizado).
6. Tabla con búsqueda y filtros.
7. Formulario con campos, validación y mensajes de error.
8. Tarjeta de indicador (KPI) con valor grande y etiqueta.
9. Línea de tiempo de entrega (Registrado, En camino, Entregado).
10. Estado vacío y estado de carga con esqueleto.

DATOS DE EJEMPLO (úsalos en todas las pantallas)
- Clientes: Cliente A, Av. Principal 120, pedido COD-101. Cliente B, Jr. Los Pinos 432, pedido COD-102. Cliente C, Av. Universitaria 77, pedido COD-103.
- Choferes: Carlos Quispe, Ana Torres, Luis Huamán.
- Vehículos: Camioneta ABC-123 y Camión DEF-456.
- Productos: Cemento tipo I (bolsa de 42,5 kg), fierro corrugado de 1/2" (varilla de 9 m), ladrillo King Kong (unidad).
- Parámetros: rendimiento 10 km/L, combustible S/ 6,20 por litro.
- Alternativa A (más corta): A → B → C, 14,2 km, 42 min con tráfico, 1,42 L, S/ 8,80.
- Alternativa B (más rápida, elegida): B → A → C, 16,0 km, 31 min con tráfico, 1,60 L, S/ 9,92.
- Alternativa C (equilibrada): A → C → B, 14,8 km, 34 min con tráfico, 1,48 L, S/ 9,18.
- Reparto R-001: 3 paradas, orden B → A → C, chofer Carlos Quispe, Camioneta ABC-123.
- Recorrido de referencia: 52 min frente a 31 min de la ruta elegida, 21 min ahorrados.

REGLAS DE ORGANIZACIÓN EN FIGMA
- Nombra cada frame con su ID y título, por ejemplo "P-D01 Panel del día".
- Crea los estilos de color y de texto, y los componentes, en una página llamada "Sistema de diseño".
- Crea una página por rol: "Despachador", "Chofer", "Administrador", "Cliente y compartidas".

Por ahora SOLO crea la página "Sistema de diseño" con los estilos y los 10 componentes. En los siguientes mensajes te pediré las pantallas de cada rol.
```

---

## Prompt 1 · Despachador / almacén (10 pantallas, escritorio)

```
Ahora diseña la página "Despachador" con 10 frames de escritorio (1440 px). Reutiliza los componentes del sistema de diseño. Todos comparten una barra lateral con: Panel, Pedidos, Inventario, Clientes, Repartos, Historial, y el nombre del usuario con "Cerrar sesión" abajo.

P-D01 Panel del día
Tarjetas (KPI) con la cantidad de pedidos por estado: Pendiente, En preparación, Listo, En ruta, Entregado. Lista de alertas de plazos por vencer (por ejemplo "El pedido COD-102 vence en 3 horas"). Tarjeta de repartos en curso (R-001, 1 de 3 entregas confirmadas). Tarjeta con choferes y vehículos disponibles. Accesos rápidos "Nuevo pedido" y "Armar reparto".

P-D02 Lista de pedidos
Tabla con búsqueda y filtros por estado, prioridad y fecha límite. Columnas: código, cliente, estado (distintivo), prioridad, fecha límite. Botón "Nuevo pedido". Muestra varias filas con estados distintos.

P-D03 Detalle y formulario de pedido
Cliente, productos con cantidades (tabla editable), fecha de pedido y fecha límite. Botones de cambio de estado según el estado actual: "Pasar a preparación", "Marcar Listo", "Cancelar". Muestra un banner de error: "Stock insuficiente: faltan 20 unidades de Cemento tipo I. El pedido sigue en Pendiente." Panel lateral con el historial de estados.

P-D04 Clientes
Lista de clientes a la izquierda y formulario a la derecha: nombre, contacto, dirección exacta y coordenadas. Mapa pequeño con un marcador para ubicar el punto de entrega.

P-D05 Inventario
Tabla por producto con existencias totales, reservadas y disponibles. Indicador de stock bajo. Botones "Registrar entrada" y "Ajustar existencias" que abren un panel lateral con cantidad y motivo.

P-D06 Armar reparto
Lista de pedidos en estado Listo, ordenada por prioridad, con selección múltiple (casillas). Panel lateral de resumen: cantidad de clientes seleccionados, peso total y capacidad del vehículo. Botón principal "Calcular ruta". Muestra 3 pedidos seleccionados (COD-101, COD-102, COD-103).

P-D07 Comparar rutas
Tres tarjetas de alternativa (A más corta, B más rápida, C equilibrada) con los datos de ejemplo; la B aparece seleccionada y marcada como "Elegida". Selector de criterio: Menor tiempo, Menor combustible, Equilibrio. Mapa con paradas numeradas y línea de ruta. Banner de advertencia: "La llegada estimada a Cliente C supera su fecha límite." Distintivo "Sin tráfico real" visible en una variante. Botón "Aprobar ruta".

P-D08 Asignación
Dos listas: choferes disponibles (Carlos Quispe, Ana Torres, Luis Huamán) y vehículos disponibles (Camioneta ABC-123, Camión DEF-456), con una indicación de capacidad. Resumen de la ruta (R-001, 3 paradas, orden B → A → C). Botón "Confirmar asignación". Después de confirmar, muestra el estado del aviso por WhatsApp (variante enviado y variante fallido con el mensaje: "No se pudo enviar el aviso por WhatsApp. La asignación sigue disponible en el panel del chofer.").

P-D09 Monitoreo del reparto
Encabezado con R-001 y barra de avance "1 / 3 entregas". Lista de paradas con su estado (una Entregada, una En camino, una Pendiente). KPIs: kilómetros previstos 16,0, tiempo estimado 31 min, combustible estimado S/ 9,92. Panel de incidencias abiertas. Mapa con la secuencia.

P-D10 Historial de repartos
Tabla de repartos cerrados con fecha, chofer, vehículo y resultado (por ejemplo "3 de 3 entregadas"). Un panel de detalle abierto con las paradas, las horas y los indicadores de la ruta.
```

---

## Prompt 2 · Chofer (6 pantallas, celular)

```
Ahora diseña la página "Chofer" con 6 frames de celular (390 x 844 px). Diseño mobile-first: botones grandes de al menos 48 px, texto legible al sol y UNA acción principal por pantalla. Navegación inferior con dos pestañas: "Mi ruta" y "Perfil".

P-CH01 Mi ruta
Tarjeta de la ruta asignada: código R-001, 3 paradas, orden B → A → C, vehículo Camioneta ABC-123. Botón grande "Iniciar reparto". Incluye una variante de estado vacío: "No tienes una ruta asignada por ahora."

P-CH02 Ruta en curso
Barra de avance "1 / 3 entregas". La siguiente parada destacada arriba con distintivo "En camino". Debajo, la lista de paradas con el componente de tarjeta de parada y su estado. Un interruptor para alternar entre "Lista" y "Mapa" (el mapa muestra paradas numeradas). Incluye una variante con una parada reprogramada que muestra el aviso "Intento 1 de 2".

P-CH03 Detalle de parada
Nombre del cliente, dirección, contacto con botón de llamada, lista de productos con cantidades y hora estimada de llegada. Dos botones: "Confirmar entrega" (principal) y "Reportar incidencia" (secundario).

P-CH04 Confirmar entrega
Campo "Nombre de quien recibió", hora automática (solo lectura) y observaciones opcionales. Botón "Confirmar". Incluye una variante de éxito: "Entrega confirmada" con botón "Ir a la siguiente parada".

P-CH05 Registrar incidencia
Selector de causa con tres opciones: Cliente ausente, Dirección errónea, Otra. Campo de observaciones. Botón "Guardar incidencia". Incluye dos variantes del mensaje de resultado: "Entrega reprogramada: intento 1 de 2." y "Se agotaron los intentos. El pedido vuelve a Listo."

P-CH06 Resumen de ruta
Se muestra al resolver la última parada. Tarjetas con entregas completadas, no entregadas, tiempo total y kilómetros. Botón "Volver a Mi ruta".
```

---

## Prompt 3 · Administrador (8 pantallas, escritorio)

```
Ahora diseña la página "Administrador" con 8 frames de escritorio (1440 px). Barra lateral con: Indicadores, Usuarios, Productos, Vehículos, Parámetros, Historial, Datos de ejemplo. El Administrador también puede ver en solo lectura las pantallas de monitoreo e historial del despachador, así que añade en la barra lateral un grupo "Operación (solo lectura)" con "Monitoreo" e "Historial".

P-A01 Panel de indicadores
Filtro por rango de fechas. Tarjetas (KPI): entregas completadas, incidencias, tiempo total, kilómetros totales y combustible estimado en soles. Gráfico de tendencia de entregas por día y gráfico de barras de incidencias por causa.

P-A02 Usuarios
Tabla con nombre, correo, rol (Despachador, Chofer, Administrador) y estado (activo o inactivo). Panel de formulario para crear o editar, con selector de rol e interruptor para activar o desactivar.

P-A03 Productos
Tabla y formulario con nombre, unidad, peso (kg) y stock inicial. Usa los tres productos de ejemplo.

P-A04 Vehículos
Tabla y formulario con placa, tipo, capacidad de carga (kg), velocidad promedio (km/h), rendimiento (km/L) y disponibilidad. Usa la Camioneta ABC-123 y el Camión DEF-456.

P-A05 Parámetros
Tres bloques: ubicación del almacén (mapa con marcador movible), precio del combustible por litro (S/ 6,20) y minutos por parada. Botón "Guardar" y mensaje de confirmación.

P-A06 Ruta elegida frente a referencia
Gráfico de barras comparando la ruta elegida y el recorrido de referencia en tiempo (31 vs 52 min), kilómetros y combustible. Tarjeta destacada con el ahorro estimado: "21 min ahorrados". Selector para elegir el reparto a comparar.

P-A07 Historial y auditoría
Tabla de rutas y entregas con búsqueda y filtros. Panel con el registro de cambios de estado: estado anterior, estado nuevo, usuario y hora.

P-A08 Datos de ejemplo
Dos botones: "Cargar datos de ejemplo" y "Restablecer". Al presionar "Restablecer" aparece un cuadro de diálogo de confirmación explícita: "Esto reemplazará los datos actuales. ¿Continuar?".
```

---

## Prompt 4 · Cliente y pantallas compartidas (4 pantallas)

```
Ahora diseña la página "Cliente y compartidas" con 4 frames.

P-CL01 Consultar entrega (celular, 390 x 844 px)
Logo CODIMAC arriba, título "Consulta tu entrega", campo "Código de tu pedido" (ejemplo COD-101) y botón "Consultar". Incluye una variante de error: "No encontramos un pedido con ese código." No hay inicio de sesión.

P-CL02 Estado de mi entrega (celular, 390 x 844 px)
Código del pedido COD-101. Línea de tiempo con los tres estados: Registrado, En camino (activo) y Entregado. Tarjeta con la posición "Parada 2 de 3" y el tiempo estimado de llegada "22 min". Incluye una variante con un mensaje de reprogramación cuando hay una incidencia. Esta pantalla NO muestra datos de otros clientes del reparto.

P-G01 Inicio de sesión (escritorio, 1440 px)
Pantalla centrada con logo, campos de correo y contraseña, botón "Ingresar" y mensaje de error: "Correo o contraseña incorrectos." Incluye una variante de carga con el texto "Conectando…" (la base de datos puede tardar en responder la primera vez).

P-G02 Sin acceso (escritorio, 1440 px)
Mensaje "No tienes acceso a esta sección" con un botón "Volver al inicio".
```

---

## Prompt 5 · Prototipo y flujos (pegar al final)

```
Conecta los frames como prototipo interactivo, con estas secuencias:

F-1 Del pedido a Listo (Despachador): P-D04 → P-D03 → P-D05 → P-D03.
F-2 De pedidos Listo a un reparto asignado (Despachador): P-D06 → P-D07 → P-D08 → P-D09.
F-3 Reparto completo (Chofer): P-CH01 → P-CH02 → P-CH03 → P-CH04 → P-CH06.
F-3b Variante con incidencia (Chofer): P-CH03 → P-CH05 → P-CH02.
F-4 Consulta del cliente: P-CL01 → P-CL02.
F-5 Administración: P-A02, P-A03, P-A04 y P-A05, luego P-A01.

Además:
- P-G01 redirige según el rol: Despachador a P-D01, Chofer a P-CH01, Administrador a P-A01.
- Usa transiciones simples (deslizar en celular, desvanecer en escritorio).
- Revisa que todos los textos estén en español, que cada estado tenga texto o ícono además del color y que los botones del celular midan al menos 48 px de alto.
- Entrega una lista de los frames que no quedaron conectados, si los hay.
```

---

## Consejos

- **Si algo no cabe:** pide los frames de a 3 o 4 por mensaje, repitiendo "usa el sistema de diseño ya creado".
- **Para corregir:** indica el ID del frame ("en P-D07, la tarjeta B debería ser más ancha"), ya que cada pantalla tiene su ID como nombre.
- **Antes de pasar al siguiente rol:** revisa que los distintivos de estado sean el mismo componente en todos los frames; si no, pídele que los reemplace por la instancia del componente.
