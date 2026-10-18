import "dotenv/config"
import { z } from "zod"

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatorio"),
  JWT_SECRET: z.string()
    .min(32, "JWT_SECRET debe tener al menos 32 caracteres")
    .refine((value) => !value.startsWith("replace-with-"), "Reemplaza el JWT_SECRET de ejemplo"),
  CORS_ORIGIN: z.string().default("http://localhost:8443"),
  DATABASE_SSL: z.enum(["true", "false"]).default("true"),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  throw new Error(`Configuración inválida: ${z.flattenError(parsed.error).formErrors.join("; ")}`)
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
}
