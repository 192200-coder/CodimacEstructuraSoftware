import type { PoolClient } from "pg"
import { hashPassword } from "../http/auth.js"

const demoUsers = [
  { id: "90000000-0000-4000-8000-000000000001", email: "maria@codimac.pe", name: "María Quispe", role: "Despachador" },
  { id: "90000000-0000-4000-8000-000000000002", email: "carlos@codimac.pe", name: "Carlos Quispe", role: "Chofer" },
  { id: "90000000-0000-4000-8000-000000000003", email: "jose@codimac.pe", name: "José Ramírez", role: "Administrador" },
] as const

export async function loadDemoData(client: PoolClient): Promise<void> {
  for (const user of demoUsers) {
    await client.query(
      `INSERT INTO profiles(id,email,password_hash,display_name,role)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING`,
      [user.id, user.email, await hashPassword("demostracion"), user.name, user.role],
    )
  }

  await client.query(
    `INSERT INTO clients(id,name,contact,address,latitude,longitude) VALUES
      ('10000000-0000-4000-8000-000000000001','Cliente A','+51 900 000 001','Av. Principal 120',-13.620000,-72.865000),
      ('10000000-0000-4000-8000-000000000002','Cliente B','+51 900 000 002','Jr. Los Pinos 432',-13.655000,-72.860000),
      ('10000000-0000-4000-8000-000000000003','Cliente C','+51 900 000 003','Av. Universitaria 77',-13.650000,-72.910000)
     ON CONFLICT(id) DO NOTHING;
     INSERT INTO products(id,name,unit,weight_kg,total_stock) VALUES
      ('20000000-0000-4000-8000-000000000001','Cemento tipo I','Bolsa de 42,5 kg',42.5,280),
      ('20000000-0000-4000-8000-000000000002','Fierro corrugado de 1/2\"','Varilla de 9 m',8,85),
      ('20000000-0000-4000-8000-000000000003','Ladrillo King Kong','Unidad',2.8,1840)
     ON CONFLICT(id) DO NOTHING;
     INSERT INTO vehicles(id,plate,vehicle_type,capacity_kg,average_speed_kmh,fuel_efficiency_km_l) VALUES
      ('30000000-0000-4000-8000-000000000001','ABC-123','Camioneta',1500,30,10),
      ('30000000-0000-4000-8000-000000000002','DEF-456','Camión',4000,25,8)
     ON CONFLICT(id) DO NOTHING;
     INSERT INTO global_parameters(singleton,warehouse_latitude,warehouse_longitude,fuel_price,minutes_per_stop)
      VALUES(true,-13.6366,-72.8814,6.2,8) ON CONFLICT(singleton) DO NOTHING;`,
  )

  const createdBy = demoUsers[0].id
  const orders = [
    { id: "40000000-0000-4000-8000-000000000001", code: "COD-101", token: "50000000-0000-4000-8000-000000000001", client: "10000000-0000-4000-8000-000000000001", deadline: "2026-10-20T17:30:00-05:00" },
    { id: "40000000-0000-4000-8000-000000000002", code: "COD-102", token: "50000000-0000-4000-8000-000000000002", client: "10000000-0000-4000-8000-000000000002", deadline: "2026-10-20T14:00:00-05:00" },
    { id: "40000000-0000-4000-8000-000000000003", code: "COD-103", token: "50000000-0000-4000-8000-000000000003", client: "10000000-0000-4000-8000-000000000003", deadline: "2026-10-21T10:00:00-05:00" },
  ]
  for (const order of orders) {
    await client.query(
      `INSERT INTO orders(id,code,tracking_token,client_id,deadline_at,created_by)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,
      [order.id, order.code, order.token, order.client, order.deadline, createdBy],
    )
  }
  await client.query(
    `INSERT INTO order_items(order_id,product_id,quantity) VALUES
      ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',20),
      ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003',120),
      ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',40),
      ('40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002',15)
     ON CONFLICT(order_id,product_id) DO NOTHING`,
  )
}
