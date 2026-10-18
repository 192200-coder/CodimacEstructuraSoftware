import { Router } from "express"
import { z } from "zod"
import type { AuthenticationUseCases } from "../application/authentication.js"
import { authenticate } from "../http/auth.js"
import { pool } from "../db/pool.js"

export function createAuthRouter(useCases: AuthenticationUseCases) {
  const router = Router()

  router.post("/login", async (req, res) => {
    const { email, password } = z.object({
      email: z.email().transform((value) => value.toLowerCase()),
      password: z.string().min(1).max(256),
    }).parse(req.body)
    res.json(await useCases.login(email, password))
  })

  router.get("/me", authenticate, (req, res) => {
    res.json({ user: req.user })
  })

  router.post("/logout", authenticate, async (req, res) => {
    await pool.query(
      "UPDATE auth_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",
      [req.authSessionId, req.user!.id],
    )
    res.json({ loggedOut: true })
  })

  return router
}
