import z from "zod";

import { engineLineSchema } from "./EngineLine";
import { moveSchema } from "./Move";
import { Classification } from "@shared/constants/Classification";
import PieceColour from "@shared/constants/PieceColour";

export const boardStateSchema = z.object({
    fen: z.string(),
    move: moveSchema.optional(),
    moveColour: z.enum(PieceColour).optional(),
    engineLines: z.array(engineLineSchema),
    classification: z.enum(Classification).optional(),
    accuracy: z.number().optional(),
    opening: z.string().optional(),
    // Seconds left on the mover's clock after the move
    clock: z.number().optional(),
    // Seconds the mover spent on the move
    moveTime: z.number().optional()
});

export type BoardState = z.infer<typeof boardStateSchema>;