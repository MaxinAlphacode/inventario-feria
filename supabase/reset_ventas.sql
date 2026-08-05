-- ============================================================
--  BORRAR TODAS LAS VENTAS Y DEJAR LOS REPORTES EN CERO
--
--  Usar para limpiar datos de prueba antes de la feria, o para
--  arrancar de cero una feria nueva.
--
--  OJO: esto BORRA el historial de ventas y no se puede deshacer.
--  Devuelve al stock las unidades que esas ventas habian descontado,
--  para que el inventario vuelva a cuadrar.
--
--  Ejecutar en: Supabase -> SQL Editor -> New query
-- ============================================================

begin;

-- 1) Ver que se va a borrar (queda en la pestaña de resultados)
select product_name, count(*) as unidades, sum(price) as ingreso
  from sales
 group by product_name
 order by unidades desc;

-- 2) Devolver al stock lo que descontaron esas ventas
update products p
   set stock = p.stock + v.unidades,
       updated_at = now()
  from (
    select product_id, count(*) as unidades
      from sales
     where product_id is not null
     group by product_id
  ) v
 where p.id = v.product_id;

-- 3) Borrar el historial
delete from sales;

commit;

-- Verificacion: deberia devolver 0
select count(*) as ventas_restantes from sales;
