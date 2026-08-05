# Inventario Feria

Inventario y ventas para una tienda pequeña en una feria.

- **Inventario**: lista de productos con precio, costo y cuántos quedan.
- **Carrito**: agrega uno o más productos y registra la venta completa de una sola vez.
- **Importar**: crea productos en lote o actualiza precios/stock subiendo un Excel.
- **Reportes**: cuántas piezas se vendieron, cuánto se vendió, cuánto costó, cuánta ganancia y cuánto queda.
- **PIN**: una clave compartida protege la app.
- **Multi-dispositivo**: varias personas venden a la vez y el stock se sincroniza solo.

Stack: Next.js 16 (App Router) · Supabase (Postgres + Realtime) · Tailwind CSS · ExcelJS · Vercel.

---

## 1. Supabase

1. Crear un proyecto en [supabase.com](https://supabase.com).
2. Ir a **SQL Editor → New query**, pegar todo el contenido de
   [`supabase/schema.sql`](supabase/schema.sql) y ejecutarlo.
   Crea las tablas, la función de venta y las políticas de acceso, y habilita
   Realtime. Se puede volver a correr sin romper nada, incluso para actualizar
   un proyecto que ya tenía una versión anterior del esquema.
3. Ir a **Settings → API** y copiar `Project URL` y la llave `anon public`.
4. En la misma pantalla, copiar el **JWT Secret** (en *JWT Settings*; en proyectos
   nuevos puede aparecer bajo *API Keys → Legacy*). Es distinto de la llave anon
   y **no debe publicarse**: es lo que firma la sesión de la app.

## 2. Correr localmente

Crear un archivo `.env.local` en la raíz (ver [`.env.example`](.env.example)):

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_JWT_SECRET=...
APP_PIN=elige-un-pin
```

Luego:

```bash
npm install
```

```bash
npm run dev
```

## 3. Desplegar en Vercel

```bash
npx vercel login
```

```bash
npx vercel link
```

Cargar las cuatro variables de entorno (pide el valor para cada ambiente):

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_URL
```

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
```

```bash
npx vercel env add SUPABASE_JWT_SECRET
```

```bash
npx vercel env add APP_PIN
```

Y publicar:

```bash
npx vercel --prod
```

> Si después se cambia el `APP_PIN` en Vercel hay que volver a desplegar, y
> todos los dispositivos tendrán que ingresar el PIN nuevo.

---

## Cómo funciona por dentro

**Nunca se vende de más.** El botón "Registrar compra" no hace un `update`
desde el navegador: llama a la función `sell_cart()` de Postgres, que recibe
todo el carrito y descuenta el stock de cada producto en una sola transacción,
con un `where stock >= cantidad` que actúa como candado. Si dos celulares
venden las últimas unidades al mismo tiempo, o si algún producto del carrito
ya no tiene stock suficiente, la compra completa se cancela (no queda a medio
registrar) y la app avisa cuál producto falló.

**Los reportes no cambian con el tiempo.** Cada venta guarda una copia del
nombre, precio y costo del producto en ese momento. Si después se edita el
precio o se borra el producto, los reportes históricos siguen correctos.

**Importar por Excel** (botón "Importar" en el encabezado) usa dos plantillas:
"Crear Productos" para altas nuevas, y "Actualizar Inventario" para editar
nombre/precio/costo/stock de lo que ya existe (exporta el inventario actual
con una columna `ID` que identifica cada fila; no hay que tocarla). Los `.xlsx`
se generan y se leen en el servidor, en `/api/excel/*` — la librería de Excel
no funciona de forma confiable en el navegador y pesa ~1 MB, así que no se
manda al cliente. Esas rutas quedan detrás del mismo PIN que el resto.

**Sincronización.** Supabase Realtime empuja los cambios de stock a todos los
dispositivos conectados, incluyendo lo que entra por una importación masiva.
Además se refresca al volver a la pestaña, por si se perdió la conexión. La
consistencia real no depende de esto, sino de la función transaccional de
arriba.

**El PIN protege la base de datos, no solo las pantallas.** Este es el detalle
que más fácil se hace mal, así que vale explicarlo.

La llave `anon` de Supabase se compila dentro del JavaScript del navegador
(es lo que significa el prefijo `NEXT_PUBLIC_`), y Next.js sirve sus archivos
estáticos **sin** pasar por el proxy del PIN. Si las políticas RLS le dieran
permisos al rol `anon`, cualquiera con la URL podría abrir un chunk de
`/_next/static/`, sacar la llave y consultar la API de Supabase directamente:
leería el inventario completo y las ventas, y podría borrarlo todo, sin
escribir el PIN ni una vez.

Por eso el flujo es:

1. `proxy.js` revisa una cookie `httpOnly` con el hash del PIN y, si falta,
   redirige a `/pin`. Esto cubre páginas **y** rutas `/api/*`.
2. Ya adentro, el cliente pide `/api/token`. El servidor firma ahí un JWT con
   rol `authenticated` usando `SUPABASE_JWT_SECRET`, que nunca sale del
   servidor (ver [`lib/supabaseToken.js`](lib/supabaseToken.js)).
3. Las políticas RLS exigen `authenticated`, no `anon`. Sin ese token la llave
   pública no sirve para nada.

Sigue siendo una credencial compartida por todo el equipo: no distingue quién
hizo cada venta, y quien tenga el PIN tiene acceso completo. Es lo adecuado
para una herramienta interna y temporal, pero la base ya no queda expuesta a
cualquiera que tenga el enlace.
