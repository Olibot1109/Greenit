const { shuffle } = require('./utils');

function createPuzzleState(set) {
  const rows = 4;
  const cols = 4;
  const totalTiles = rows * cols;
  const imageUrl = (Array.isArray(set?.questions) ? set.questions : []).find((question) => String(question?.imageUrl || '').trim())?.imageUrl || null;
  const revealOrder = shuffle(Array.from({ length: totalTiles }, (_, index) => index));
  return {
    rows,
    cols,
    totalTiles,
    imageUrl,
    revealOrder,
    revealedTileIndices: [],
    lastRevealedTile: null,
    completedAt: null,
  };
}

function getPuzzlePayload(game) {
  const puzzle = game?.puzzle;
  if (!puzzle) return null;
  const rows = Math.max(1, Number(puzzle.rows) || 4);
  const cols = Math.max(1, Number(puzzle.cols) || 4);
  const totalTiles = Math.max(1, Number(puzzle.totalTiles) || rows * cols);
  const revealed = Array.isArray(puzzle.revealedTileIndices) ? puzzle.revealedTileIndices.map((index) => Number(index)).filter(Number.isInteger) : [];
  const revealedSet = new Set(revealed);
  return {
    rows,
    cols,
    totalTiles,
    imageUrl: puzzle.imageUrl || null,
    revealedCount: revealed.length,
    completed: revealed.length >= totalTiles,
    lastRevealedTile: Number.isInteger(puzzle.lastRevealedTile) ? puzzle.lastRevealedTile : null,
    tiles: Array.from({ length: totalTiles }, (_, index) => ({
      index,
      number: index + 1,
      revealed: revealedSet.has(index),
      row: Math.floor(index / cols),
      col: index % cols,
    })),
  };
}

function revealNextPuzzleTile(game) {
  const puzzle = game?.puzzle;
  if (!puzzle) return null;
  if (!Array.isArray(puzzle.revealedTileIndices)) puzzle.revealedTileIndices = [];
  if (!Array.isArray(puzzle.revealOrder)) puzzle.revealOrder = [];
  const revealedSet = new Set(puzzle.revealedTileIndices.map((index) => Number(index)).filter(Number.isInteger));
  let tileIndex = null;
  for (const candidate of puzzle.revealOrder) {
    const normalized = Number(candidate);
    if (!Number.isInteger(normalized)) continue;
    if (revealedSet.has(normalized)) continue;
    tileIndex = normalized;
    break;
  }
  if (!Number.isInteger(tileIndex)) {
    return {
      tileIndex: null,
      tileNumber: null,
      revealedCount: revealedSet.size,
      totalTiles: puzzle.totalTiles,
      completed: revealedSet.size >= puzzle.totalTiles,
    };
  }
  puzzle.revealedTileIndices.push(tileIndex);
  puzzle.lastRevealedTile = tileIndex;
  const revealedCount = puzzle.revealedTileIndices.length;
  const completed = revealedCount >= puzzle.totalTiles;
  if (completed && !puzzle.completedAt) puzzle.completedAt = new Date().toISOString();
  return {
    tileIndex,
    tileNumber: tileIndex + 1,
    revealedCount,
    totalTiles: puzzle.totalTiles,
    completed,
  };
}

module.exports = {
  createPuzzleState,
  getPuzzlePayload,
  revealNextPuzzleTile,
};
