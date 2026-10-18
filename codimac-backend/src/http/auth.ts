import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { randomUUID } from "node:crypto"
import type { NextFunction, Request, Response } from "express"
import { z } from "zod"
import { config } from "../config.js"
import { pool } from "../db/pool.js"
import { HttpError } from "./errors.js"
import { registrarEventoAuditoria } from "../application/registro-auditoria.js"
import { PostgresRegistroAuditoria } from "../adapters/postgres-registro-auditoria.js"

export type Role = "Despachador" | "Chofer" | "Administrador"
export interface AuthUser {
  id: string
  email: string
  display_name: string
  role: Role
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
      authSessionId?: string
    }
  }
}

const loginSchema = z.object({
  email: z.email().transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(256),
})

export async function login(emailInput: unknown, passwordInput: unknown) {
  const { email, password } = loginSchema.parse({ email: emailInput, password: passwordInput })
  const result = await pool.query(
    `SELECT id, email, display_name, role, password_hash, active
     FROM profiles WHERE email = $1`,
    [email],
  )
  const profile = result.rows[0] as (AuthUser & { password_hash: string; active: boolean }) | undefined
  if (!profile || !profile.active || !(await bcrypt.compare(password, profile.password_hash))) {
    await registrarEventoAuditoria(
      new PostgresRegistroAuditoria(async (text, values) => {
        await pool.query(text, values)
      }),
      {
        usuarioId: profile?.id ?? null,
        accion: "Inicio de sesión fallido",
        entidad: "Autenticación",
        entidadId: profile?.id ?? null,
        valorAnterior: null,
        valorNuevo: {
          correoIngresado: email,
          motivo: !profile ? "Cuenta no encontrada" : !profile.active ? "Cuenta inactiva" : "Credenciales incorrectas",
        },
      },
    )
    throw new HttpError(401, "Correo o contraseña incorrectos")
  }
  const user: AuthUser = {
    id: profile.id,
    email: profile.email,
    display_name: profile.display_name,
    role: profile.role,
  }
  const authSessionId = randomUUID()
  await pool.query(
    "INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",
    [authSessionId, user.id],
  )
  await pool.query("DELETE FROM auth_sessions WHERE expires_at<now() OR revoked_at<now()-interval '30 days'")
  const token = jwt.sign({ sub: user.id, jti: authSessionId }, config.JWT_SECRET, { expiresIn: "8h" })
  return { token, user }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const authorization = req.header("authorization")
    if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "Autenticación requerida")
    let claims: jwt.JwtPayload
    try {
      claims = jwt.verify(authorization.slice(7), config.JWT_SECRET) as jwt.JwtPayload
    } catch {
      throw new HttpError(401, "La sesión no es válida o ha expirado")
    }
    const result = await pool.query(
      `SELECT p.id,p.email,p.display_name,p.role,s.id AS auth_session_id
       FROM profiles p JOIN auth_sessions s ON s.user_id=p.id
       WHERE p.id=$1 AND s.id=$2 AND p.active=true AND s.revoked_at IS NULL AND s.expires_at>now()`,
      [claims.sub, claims.jti],
    )
    if (!result.rowCount) throw new HttpError(401, "La sesión fue revocada o la cuenta está inactiva")
    req.authSessionId = result.rows[0].auth_session_id as string
    const { auth_session_id: _sessionId, ...user } = result.rows[0] as AuthUser & { auth_session_id: string }
    req.user = user
    next()
  } catch (error) {
    next(error)
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new HttpError(403, "No tienes permiso para realizar esta operación"))
      return
    }
    next()
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12)
}
