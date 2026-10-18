import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import type { NextFunction, Request, Response } from "express"
import { config } from "../config.js"
import { pool } from "../db/pool.js"
import { HttpError } from "./errors.js"

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
