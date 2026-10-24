import dotenv from "dotenv"
import { z } from "zod"

// RNF-22: CODIMAC_ENV elige el archivo de entorno (.env.development, .env.test, .env.demo,
// .env.production); .env queda como respaldo común. Cada entorno apunta a su propia base.
export const codimacEnv = process.env.CODIMAC_ENV ?? "development"
dotenv.config({ path: [`.env.${codimacEnv}`, ".env"], quiet: true })

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatorio"),
  JWT_SECRET: z.string()
    .min(32, "JWT_SECRET debe tener al menos 32 caracteres")
    .refine((value) => !value.startsWith("replace-with-"), "Reemplaza el JWT_SECRET de ejemplo"),
  CORS_ORIGIN: z.string().default("http://localhost:8443"),
  DATABASE_SSL: z.enum(["true", "false"]).default("true"),
  GOOGLE_MAPS_API_KEY: z.string().default(""),
  // RF-02.1: clave de servidor para Google Routes API (matriz con tráfico). Vacía = estimador local.
  GOOGLE_ROUTES_API_KEY: z.string().default(""),
  // M-05: el restablecimiento borra datos; solo se habilita a propósito en entornos de demostración.
  DEMO_RESET_ENABLED: z.enum(["true", "false"]).default("false"),
  // RNF-07: en producción se exige HTTPS (detrás de un proxy que envía X-Forwarded-Proto).
  FORCE_HTTPS: z.enum(["true", "false"]).optional(),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  throw new Error(`Configuración inválida: ${z.flattenError(parsed.error).formErrors.join("; ")}`)
}

export const config = {
  ...parsed.data,
  forceHttps: (parsed.data.FORCE_HTTPS ?? (parsed.data.NODE_ENV === "production" ? "true" : "false")) === "true",
  corsOrigins: parsed.data.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
}
