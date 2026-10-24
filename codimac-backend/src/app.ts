import cors from "cors"
import express from "express"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import { config } from "./config.js"
import { BcryptPasswordHasher } from "./adapters/bcrypt-password-hasher.js"
import { PostgresCatalogRepository } from "./adapters/postgres-catalog-repository.js"
import { PostgresAuthenticationRepository } from "./adapters/postgres-authentication-repository.js"
import { PostgresOrderRepository } from "./adapters/postgres-order-repository.js"
import { PostgresRouteRepository } from "./adapters/postgres-route-repository.js"
import { WhatsAppSimulado } from "./adapters/whatsapp-simulado.js"
import { createAuthenticationUseCases } from "./application/authentication.js"
import { createCatalogUseCases } from "./application/catalog.js"
import { createOrderUseCases } from "./application/orders.js"
import { createRouteUseCases } from "./application/routes.js"
import { randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { errorHandler, HttpError } from "./http/errors.js"
import { createAuthRouter } from "./modules/auth.router.js"
import { createCatalogRouter } from "./modules/catalog.router.js"
import { createOrdersRouter } from "./modules/orders.router.js"
import { publicRouter } from "./modules/public.router.js"
import { createRoutesRouter } from "./modules/routes.router.js"
import { sharedRouter } from "./modules/shared.router.js"

const passwordHasher = new BcryptPasswordHasher()
const catalogUseCases = createCatalogUseCases(
  new PostgresCatalogRepository(passwordHasher),
  passwordHasher,
)
const routeUseCases = createRouteUseCases(new PostgresRouteRepository(), new WhatsAppSimulado())
const orderUseCases = createOrderUseCases(new PostgresOrderRepository())
const authenticationUseCases = createAuthenticationUseCases(
  new PostgresAuthenticationRepository(),
  { verify: (password, passwordHash) => bcrypt.compare(password, passwordHash) },
  randomUUID,
  (userId, sessionId) =>
    jwt.sign({ sub: userId, jti: sessionId }, config.JWT_SECRET, { expiresIn: "8h" }),
)

export const app = express()
app.disable("x-powered-by")
app.use(helmet())
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(new HttpError(403, "Origen no permitido por CORS"))
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}))
app.use(express.json({ limit: "1mb" }))
app.use(rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Demasiadas solicitudes. Intenta nuevamente más tarde.",
        fields: [],
      },
    })
  },
}))

app.use("/", publicRouter)
app.use("/api/auth", rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Demasiados intentos. Intenta nuevamente más tarde.",
        fields: [],
      },
    })
  },
}), createAuthRouter(authenticationUseCases))
app.use("/api", sharedRouter)
app.use("/api/orders", createOrdersRouter(orderUseCases))
app.use("/api", createCatalogRouter(catalogUseCases, {
  demoResetEnabled: config.DEMO_RESET_ENABLED === "true",
}))
app.use("/api", createRoutesRouter(routeUseCases))

app.use((_req, _res, next) => next(new HttpError(404, "Recurso no encontrado")))
app.use(errorHandler)
