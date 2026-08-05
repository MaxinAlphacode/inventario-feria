-- ============================================================
--  Inventario Feria (SOFA) — esquema completo
--  Ejecutar TODO este archivo en: Supabase -> SQL Editor -> New query
--  Es idempotente: se puede volver a correr sin romper nada, incluso
--  para actualizar un proyecto que ya tenia una version anterior.
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================ TABLAS ============================

create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text,
  price       numeric(12,2) not null default 0,   -- precio de venta
  cost        numeric(12,2) not null default 0,   -- costo
  stock       integer not null default 0 check (stock >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists sales (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid references products(id) on delete set null,
  -- Snapshot del producto al momento de la venta: si despues editan el precio
  -- o borran el producto, los reportes historicos NO cambian.
  product_name  text not null,
  category      text,
  price         numeric(12,2) not null,
  cost          numeric(12,2) not null,
  sold_at       timestamptz not null default now()
);

-- Version anterior tenia un flag de "deshacer" que ya no se usa (el carrito
-- reemplazo la venta unidad-por-unidad, y con eso el botón de deshacer).
alter table sales drop column if exists undone;

create index if not exists sales_sold_at_idx    on sales (sold_at desc);
create index if not exists sales_product_id_idx on sales (product_id);
create index if not exists products_name_idx    on products (name);

-- Ya no se usan (reemplazadas por sell_cart, ver abajo)
drop function if exists sell_product(uuid);
drop function if exists undo_last_sale();

-- ==================== RPC: VENTA ATOMICA (carrito) ====================
-- Recibe el carrito completo como jsonb: [{"product_id": "...", "qty": 2}, ...]
-- Descuenta el stock de CADA producto y registra una fila de venta por unidad,
-- todo en una sola transaccion: si algun producto no tiene stock suficiente,
-- se cancela TODA la compra (nada queda a medio registrar).
--
-- El "where stock >= v_qty" hace de lock de fila: si dos celulares venden las
-- mismas piezas casi al mismo tiempo, Postgres serializa los updates y solo
-- uno de los dos puede completar la compra si no alcanza el stock para ambos.

create or replace function sell_cart(items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item     jsonb;
  v_product  products%rowtype;
  v_qty      integer;
  v_pname    text;
  v_sold     jsonb := '[]'::jsonb;
begin
  if items is null or jsonb_array_length(items) = 0 then
    raise exception 'EMPTY_CART' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(items)
  loop
    v_qty := (v_item->>'qty')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;

    update products
       set stock = stock - v_qty,
           updated_at = now()
     where id = (v_item->>'product_id')::uuid
       and stock >= v_qty
    returning * into v_product;

    if not found then
      select name into v_pname from products where id = (v_item->>'product_id')::uuid;
      raise exception 'OUT_OF_STOCK:%', coalesce(v_pname, 'producto ya no existe') using errcode = 'P0001';
    end if;

    insert into sales (product_id, product_name, category, price, cost, sold_at)
    select v_product.id, v_product.name, v_product.category, v_product.price, v_product.cost, now()
    from generate_series(1, v_qty);

    v_sold := v_sold || jsonb_build_object('product', to_jsonb(v_product), 'qty', v_qty);
  end loop;

  return jsonb_build_object('items', v_sold);
end;
$$;

-- ============================= RLS =============================
-- IMPORTANTE: los permisos son para el rol "authenticated", NO para "anon".
--
-- La llave anon viaja dentro del JS del navegador, y Next.js sirve sus archivos
-- estaticos SIN pasar por el PIN. Si estas politicas dieran acceso a "anon",
-- cualquiera con la URL podria extraer esa llave de un chunk y leer o borrar
-- toda la base saltandose el PIN.
--
-- En su lugar, el PIN se valida en el servidor y este emite un JWT con rol
-- "authenticated" firmado con SUPABASE_JWT_SECRET (ver lib/supabaseToken.js).
-- Sin ese token, la llave anon no sirve para nada.

alter table products enable row level security;
alter table sales    enable row level security;

-- Politicas viejas basadas en anon (de versiones anteriores del esquema)
drop policy if exists "anon select products" on products;
drop policy if exists "anon insert products" on products;
drop policy if exists "anon update products" on products;
drop policy if exists "anon delete products" on products;
drop policy if exists "anon select sales"    on sales;

drop policy if exists "app select products" on products;
drop policy if exists "app insert products" on products;
drop policy if exists "app update products" on products;
drop policy if exists "app delete products" on products;
drop policy if exists "app select sales"    on sales;

create policy "app select products" on products for select to authenticated using (true);
create policy "app insert products" on products for insert to authenticated with check (true);
create policy "app update products" on products for update to authenticated using (true) with check (true);
create policy "app delete products" on products for delete to authenticated using (true);

-- sales: solo lectura directa (reportes). Las escrituras pasan SIEMPRE por
-- la funcion security definer de arriba.
create policy "app select sales" on sales for select to authenticated using (true);

revoke execute on function sell_cart(jsonb) from anon;
grant  execute on function sell_cart(jsonb) to authenticated;

-- =========================== REALTIME ===========================
-- Propaga los cambios de stock a todos los dispositivos conectados.

do $$
begin
  begin
    alter publication supabase_realtime add table products;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table sales;
  exception
    when duplicate_object then null;
  end;
end $$;
