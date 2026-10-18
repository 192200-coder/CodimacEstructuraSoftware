import { Router } from "express"
import { authenticate, login } from "../http/auth.js"
import { pool } from "../db/pool.js"

export const authRouter = Router()

authRouter.post("/login", async (req, res) => {
  res.json(await login(req.body?.email, req.body?.password))
})

authRouter.get("/me", authenticate, (req, res) => {
  res.json({ user: req.user })
})

authRouter.post("/logout", authenticate, async (req, res) => {
  await pool.query(
    "UPDATE auth_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",
    [req.authSessionId, req.user!.id],
  )
  res.json({ loggedOut: true })
})
