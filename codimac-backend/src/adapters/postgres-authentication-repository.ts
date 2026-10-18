import { inTransaction, pool } from "../db/pool.js"
import type {
  AuthenticationRepository,
  AuthenticationTransaction,
} from "../application/authentication.js"
import { PostgresRegistroAuditoria } from "./postgres-registro-auditoria.js"

type PgClient = Parameters<Parameters<typeof inTransaction>[0]>[0]

class PostgresAuthenticationTransaction implements AuthenticationTransaction {
  readonly audit: PostgresRegistroAuditoria

  constructor(private readonly client: PgClient) {
    this.audit = new PostgresRegistroAuditoria((text, values) =>
      this.client.query(text, values),
    )
  }

  async createSession(sessionId: string, userId: string): Promise<void> {
    await this.client.query(
      "INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",
      [sessionId, userId],
    )
  }

  async removeExpiredSessions(): Promise<void> {
    await this.client.query(
      "DELETE FROM auth_sessions WHERE expires_at<now() OR revoked_at<now()-interval '30 days'",
    )
  }
}

export class PostgresAuthenticationRepository implements AuthenticationRepository {
  async findProfileByEmail(email: string) {
    const result = await pool.query(
      `SELECT id,email,display_name,role,password_hash,active
       FROM profiles WHERE email=$1`,
      [email],
    )
    const profile = result.rows[0]
    return profile
      ? {
          id: profile.id as string,
          email: profile.email as string,
          display_name: profile.display_name as string,
          role: profile.role as "Despachador" | "Chofer" | "Administrador",
          passwordHash: profile.password_hash as string,
          active: profile.active as boolean,
        }
      : null
  }

  async transaction<T>(
    operation: (tx: AuthenticationTransaction) => Promise<T>,
  ): Promise<T> {
    return inTransaction((client) =>
      operation(new PostgresAuthenticationTransaction(client)),
    )
  }
}
