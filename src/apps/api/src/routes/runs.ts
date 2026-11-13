import { Router } from "express"

import { route } from "@/http/route.ts"
import { typeIdParamSchema } from "@checklog/shared/utils"

export const runsRouter = Router()

runsRouter.post("/", route({}, ({ res }) => {
  throw new Error("Not implemented")
}))

runsRouter.get("/:id", route({ params: typeIdParamSchema("runs") }, ({ res }) => {
  throw new Error("Not implemented")
}))

runsRouter.post("/:id/cancel", route({ params: typeIdParamSchema("runs") }, ({ res }) => {
  throw new Error("Not implemented")
}))
