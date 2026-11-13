import { Router } from "express"

import { route } from "@/http/route.ts"
import { typeIdParamsSchema } from "@checklog/shared/utils"

export const runStepsRouter = Router()

runStepsRouter.put("/:id/steps/:stepId/values", route({ params: typeIdParamsSchema({ id: "runs", stepId: "runSteps" }) }, ({ res }) => {
  throw new Error("Not implemented")
}))

runStepsRouter.post("/:id/steps/:stepId/complete", route({ params: typeIdParamsSchema({ id: "runs", stepId: "runSteps" }) }, ({ res }) => {
  throw new Error("Not implemented")
}))

runStepsRouter.post("/:id/steps/:stepId/skip", route({ params: typeIdParamsSchema({ id: "runs", stepId: "runSteps" }) }, ({ res }) => {
  throw new Error("Not implemented")
}))

runStepsRouter.post("/:id/steps/:stepId/notes", route({ params: typeIdParamsSchema({ id: "runs", stepId: "runSteps" }) }, ({ res }) => {
  throw new Error("Not implemented")
}))

runStepsRouter.patch("/:id/steps/:stepId/assignee", route({ params: typeIdParamsSchema({ id: "runs", stepId: "runSteps" }) }, ({ res }) => {
  throw new Error("Not implemented")
}))
