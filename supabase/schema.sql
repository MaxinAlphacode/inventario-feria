-- ============================================================
--  Inventario Feria — esquema completo
--  Ejecutar TODO este archivo en: Supabase -> SQL Editor -> New query
--  Es idempotente: se puede volver a correr para actualizar un proyecto
--  que ya tenia una version anterior.
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================ TABLAS ============================

-- Cada feria es un espacio aparte: su inventario, sus ventas y sus promociones.
create table if not exists fairs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  starts_on  date,
  ends_on    date,
  color      text not null default 'purple',
  created_at timestamptz not null default now()
);

create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  fair_id     uuid references fairs(id) on delete cascade,
  name        text not null,
  category    text,
  price       numeric(12,2) not null default 0,   -- precio de venta
  cost        numeric(12,2) not null default 0,   -- costo
  stock       integer not null default 0 check (stock >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- UNA FILA POR UNIDAD VENDIDA. Se ve redundante, pero hace que devolver stock
-- al editar una venta sea trivial y exacto.
--   sale_id  agrupa las unidades de un mismo ticket
--   price    precio de lista al momento de la venta
--   charged  lo realmente cobrado (cambia si aplico una promocion)
-- Guardar el snapshot de nombre/precio/costo evita que editar un producto
-- despues altere los reportes historicos.
create table if not exists sales (
  id             uuid primary key default gen_random_uuid(),
  fair_id        uuid references fairs(id) on delete cascade,
  sale_id        uuid,
  product_id     uuid references products(id) on delete set null,
  product_name   text not null,
  category       text,
  price          numeric(12,2) not null,
  cost           numeric(12,2) not null,
  charged        numeric(12,2),
  promotion_name text,
  sold_at        timestamptz not null default now()
);

-- tiers: [{"qty":1,"price":3000},{"qty":2,"price":5000}]
create table if not exists promotions (
  id         uuid primary key default gen_random_uuid(),
  fair_id    uuid not null references fairs(id) on delete cascade,
  name       text not null,
  category   text not null,
  enabled    boolean not null default true,
  tiers      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Migracion desde versiones anteriores del esquema
alter table sales    drop column if exists undone;
alter table products add  column if not exists fair_id        uuid references fairs(id) on delete cascade;
alter table sales    add  column if not exists fair_id        uuid references fairs(id) on delete cascade;
alter table sales    add  column if not exists sale_id        uuid;
alter table sales    add  column if not exists charged        numeric(12,2);
alter table sales    add  column if not exists promotion_name text;
update sales set charged = price where charged is null;
update sales set sale_id = id     where sale_id is null;

create index if not exists products_fair_idx  on products (fair_id);
create index if not exists products_name_idx  on products (name);
create index if not exists sales_fair_idx     on sales (fair_id);
create index if not exists sales_sale_id_idx  on sales (sale_id);
create index if not exists sales_sold_at_idx  on sales (sold_at desc);
create index if not exists promotions_fair_idx on promotions (fair_id);

-- Si no hay ninguna feria, crear una y adoptar lo que ya existiera.
do $$
declare v_fair uuid;
begin
  if not exists (select 1 from fairs) then
    insert into fairs (name, color) values ('Mi primera feria', 'purple')
    returning id into v_fair;
    update products set fair_id = v_fair where fair_id is null;
    update sales    set fair_id = v_fair where fair_id is null;
  end if;
end $$;

drop function if exists sell_product(uuid);
drop function if exists undo_last_sale();
drop function if exists sell_cart(jsonb);

-- ==================== VENTA (carrito con promociones) ====================
-- items: [{"product_id":uuid,"qty":int,"charged":numeric,"promotion_name":text|null}]
--   charged = TOTAL de la linea, ya con la promocion aplicada.
-- Descuenta stock y registra una fila por unidad en UNA transaccion: si a algun
-- producto no le alcanza el stock, se cancela la compra entera. El
-- "where stock >= v_qty" hace de candado entre dispositivos simultaneos.
create or replace function sell_cart(p_fair_id uuid, items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb; v_product products%rowtype; v_qty integer;
  v_charged numeric(12,2); v_promo text; v_pname text;
  v_sale_id uuid := gen_random_uuid(); v_sold jsonb := '[]'::jsonb;
begin
  if items is null or jsonb_array_length(items) = 0 then
    raise exception 'EMPTY_CART' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(items) loop
    v_qty     := (v_item->>'qty')::integer;
    v_charged := coalesce((v_item->>'charged')::numeric, 0);
    v_promo   := nullif(v_item->>'promotion_name', '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;

    update products set stock = stock - v_qty, updated_at = now()
     where id = (v_item->>'product_id')::uuid and stock >= v_qty
    returning * into v_product;

    if not found then
      select name into v_pname from products where id = (v_item->>'product_id')::uuid;
      raise exception 'OUT_OF_STOCK:%', coalesce(v_pname, 'producto ya no existe')
        using errcode = 'P0001';
    end if;

    insert into sales (fair_id, sale_id, product_id, product_name, category,
                       price, cost, charged, promotion_name, sold_at)
    select p_fair_id, v_sale_id, v_product.id, v_product.name, v_product.category,
           v_product.price, v_product.cost, round(v_charged / v_qty, 2), v_promo, now()
    from generate_series(1, v_qty);

    v_sold := v_sold || jsonb_build_object('product', to_jsonb(v_product), 'qty', v_qty);
  end loop;

  return jsonb_build_object('sale_id', v_sale_id, 'items', v_sold);
end; $$;

-- ==================== EDITAR VENTA ====================
-- Recibe el estado FINAL del ticket y ajusta el stock por diferencia.
-- Con items vacio, borra la venta y devuelve todo al stock.
create or replace function update_sale(p_sale_id uuid, items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fair uuid; v_item jsonb; v_qty integer; v_charged numeric(12,2);
  v_promo text; v_product products%rowtype; v_pname text; v_sold_at timestamptz;
begin
  select fair_id, sold_at into v_fair, v_sold_at
    from sales where sale_id = p_sale_id limit 1;

  if v_sold_at is null then
    raise exception 'SALE_NOT_FOUND' using errcode = 'P0001';
  end if;

  update products p set stock = p.stock + v.unidades, updated_at = now()
    from (select product_id, count(*)::int as unidades from sales
           where sale_id = p_sale_id and product_id is not null
           group by product_id) v
   where p.id = v.product_id;

  delete from sales where sale_id = p_sale_id;

  if items is not null and jsonb_array_length(items) > 0 then
    for v_item in select * from jsonb_array_elements(items) loop
      v_qty     := (v_item->>'qty')::integer;
      v_charged := coalesce((v_item->>'charged')::numeric, 0);
      v_promo   := nullif(v_item->>'promotion_name', '');

      if v_qty is null or v_qty <= 0 then
        raise exception 'INVALID_QTY' using errcode = 'P0001';
      end if;

      update products set stock = stock - v_qty, updated_at = now()
       where id = (v_item->>'product_id')::uuid and stock >= v_qty
      returning * into v_product;

      if not found then
        select name into v_pname from products where id = (v_item->>'product_id')::uuid;
        raise exception 'OUT_OF_STOCK:%', coalesce(v_pname, 'producto ya no existe')
          using errcode = 'P0001';
      end if;

      insert into sales (fair_id, sale_id, product_id, product_name, category,
                         price, cost, charged, promotion_name, sold_at)
      select v_fair, p_sale_id, v_product.id, v_product.name, v_product.category,
             v_product.price, v_product.cost, round(v_charged / v_qty, 2), v_promo, v_sold_at
      from generate_series(1, v_qty);
    end loop;
  end if;

  return jsonb_build_object('sale_id', p_sale_id);
end; $$;

-- ==================== INICIAR / BORRAR FERIA ====================
create or replace function start_fair(
  p_name text, p_starts date, p_ends date, p_color text, p_carry_from uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fair fairs%rowtype;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;

  insert into fairs (name, starts_on, ends_on, color)
  values (trim(p_name), p_starts, p_ends, coalesce(nullif(p_color,''), 'purple'))
  returning * into v_fair;

  -- Arrastra solo lo que todavia tiene stock; la feria anterior no se toca.
  if p_carry_from is not null then
    insert into products (fair_id, name, category, price, cost, stock)
    select v_fair.id, name, category, price, cost, stock
      from products where fair_id = p_carry_from and stock > 0;
  end if;

  return to_jsonb(v_fair);
end; $$;

create or replace function delete_fair(p_fair_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_productos int; v_ventas int;
begin
  select count(*) into v_productos from products where fair_id = p_fair_id;
  select count(*) into v_ventas    from sales    where fair_id = p_fair_id;
  delete from fairs where id = p_fair_id;  -- cascada: productos, ventas, promos
  return jsonb_build_object('productos', v_productos, 'ventas', v_ventas);
end; $$;

-- ============================= RLS =============================
-- Los permisos son para "authenticated", NO para "anon".
--
-- La llave anon viaja dentro del JS del navegador, y Next.js sirve sus archivos
-- estaticos SIN pasar por el PIN. Si estas politicas dieran acceso a "anon",
-- cualquiera con la URL podria extraer esa llave de un chunk y leer o borrar
-- toda la base saltandose el PIN.
--
-- En su lugar, el PIN se valida en el servidor y este emite un JWT con rol
-- "authenticated" firmado con SUPABASE_JWT_SECRET (ver lib/supabaseToken.js).

alter table fairs      enable row level security;
alter table products   enable row level security;
alter table sales      enable row level security;
alter table promotions enable row level security;

drop policy if exists "anon select products" on products;
drop policy if exists "anon insert products" on products;
drop policy if exists "anon update products" on products;
drop policy if exists "anon delete products" on products;
drop policy if exists "anon select sales"    on sales;
drop policy if exists "app select products"  on products;
drop policy if exists "app insert products"  on products;
drop policy if exists "app update products"  on products;
drop policy if exists "app delete products"  on products;
drop policy if exists "app select sales"     on sales;
drop policy if exists "app delete sales"     on sales;
drop policy if exists "app all fairs"        on fairs;
drop policy if exists "app all promotions"   on promotions;

create policy "app select products" on products for select to authenticated using (true);
create policy "app insert products" on products for insert to authenticated with check (true);
create policy "app update products" on products for update to authenticated using (true) with check (true);
create policy "app delete products" on products for delete to authenticated using (true);

-- sales: lectura para reportes y borrado para editar ventas. Las altas y el
-- ajuste de stock pasan SIEMPRE por las funciones security definer de arriba.
create policy "app select sales" on sales for select to authenticated using (true);
create policy "app delete sales" on sales for delete to authenticated using (true);

create policy "app all fairs"      on fairs      for all to authenticated using (true) with check (true);
create policy "app all promotions" on promotions for all to authenticated using (true) with check (true);

-- OJO: Postgres concede EXECUTE a PUBLIC por defecto, y PUBLIC incluye a anon.
-- Sin estos revokes, cualquiera con la llave anon (que viaja en el JS del
-- navegador) podria llamar delete_fair y borrar una feria entera saltandose
-- el PIN. Hay que revocar ANTES de conceder.
revoke execute on function sell_cart(uuid, jsonb)   from public, anon;
revoke execute on function update_sale(uuid, jsonb) from public, anon;
revoke execute on function delete_fair(uuid)        from public, anon;
revoke execute on function start_fair(text, date, date, text, uuid) from public, anon;

grant execute on function sell_cart(uuid, jsonb)   to authenticated;
grant execute on function update_sale(uuid, jsonb) to authenticated;
grant execute on function delete_fair(uuid)        to authenticated;
grant execute on function start_fair(text, date, date, text, uuid) to authenticated;

-- =========================== REALTIME ===========================
do $$
begin
  begin alter publication supabase_realtime add table products; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table sales;    exception when duplicate_object then null; end;
end $$;
