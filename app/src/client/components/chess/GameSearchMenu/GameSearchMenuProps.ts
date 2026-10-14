import Game from "@shared/types/game/Game";
import { GameSourceData } from "@client/components/chess/GameSelector/GameSource";

interface GameSearchMenuProps {
    username: string;
    gameSource: GameSourceData;
    onClose: () => void;
    onGameSelect?: (game: Game) => void;
}

export default GameSearchMenuProps;