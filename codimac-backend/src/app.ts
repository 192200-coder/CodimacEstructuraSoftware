import cors from "cors"
import express from "express"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import { config } from "./config.js"
import { errorHandler, HttpError } from "./http/errors.js"
import { authRouter } from "./modules/auth.router.js"
import { catalogRouter } from "./modules/catalog.router.js"
import { ordersRouter } from "./modules/orders.router.js"
import { publicRouter } from "./modules/public.router.js"
import { routesRouter } from "./modules/routes.router.js"
import { sharedRouter } from "./modules/shared.router.js"

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
}))

app.use("/", publicRouter)
app.use("/api/auth", rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
}), authRouter)
app.use("/api", sharedRouter)
app.use("/api/orders", ordersRouter)
app.use("/api", catalogRouter)
app.use("/api", routesRouter)

app.use((_req, _res, next) => next(new HttpError(404, "Recurso no encontrado")))
app.use(errorHandler)
