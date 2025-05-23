const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

app.use(express.static('public')); // Serve index.html, index.js, etc.

const rooms = {}; // roomId => { players, currentTurnIndex, deck }

const COLS = 50;
const TOTAL_CARDS = COLS * 20;

// 🔄 Generate a shuffled symbol deck (pairs)
function generateShuffledDeck() {
  const baseSymbols = [];
  for (let i = 0; i < TOTAL_CARDS / 2; i++) {
    baseSymbols.push(String.fromCharCode(0x2600 + (i % 256)));
  }
  const fullDeck = [...baseSymbols, ...baseSymbols];
  for (let i = fullDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fullDeck[i], fullDeck[j]] = [fullDeck[j], fullDeck[i]];
  }
  return fullDeck;
}

function getNextTurn(roomId) {
  const room = rooms[roomId];
  if (!room || room.players.length === 0) return null;
  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
  return room.players[room.currentTurnIndex].id;
}

function getPlayerNamesMap(roomId) {
  const room = rooms[roomId];
  if (!room) return {};
  const map = {};
  room.players.forEach(p => {
    map[p.id] = p.name;
  });
  return map;
}

// Helper function to check if two cards match by index
function checkMatch(room, cardIndex1, cardIndex2) {
  return room.deck[cardIndex1] === room.deck[cardIndex2];
}

// Keep flipped cards per player here — outside of connection handler to persist
const flippedCardsMap = {};

io.on('connection', (socket) => {
  console.log('✅ Connected:', socket.id);

  socket.on('joinRoom', ({ roomId, playerName }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        currentTurnIndex: -1,
        deck: generateShuffledDeck()
      };
    }

    const playerLabel = playerName || `Player_${socket.id.substring(0, 4)}`;
    const existing = rooms[roomId].players.find(p => p.id === socket.id);
    if (!existing) {
      rooms[roomId].players.push({ id: socket.id, name: playerLabel });
    }

    // Send shared deck to the new player
    socket.emit('gameDeck', rooms[roomId].deck);

    // Update player list in room
    io.to(roomId).emit('updatePlayers', getPlayerNamesMap(roomId));

    // Assign turn if not already done
    if (rooms[roomId].currentTurnIndex === -1) {
      rooms[roomId].currentTurnIndex = 0;
      const firstPlayerId = rooms[roomId].players[0].id;
      io.to(roomId).emit('turnChanged', firstPlayerId);
    } else {
      const currentTurnId = rooms[roomId].players[rooms[roomId].currentTurnIndex].id;
      socket.emit('turnChanged', currentTurnId);
    }

    // Initialize flipped cards tracking for this player
    flippedCardsMap[socket.id] = [];

    console.log(`🟢 ${playerLabel} (${socket.id}) joined ${roomId}`);
  });

  socket.on('flipCard', ({ roomId, cardIndex }) => {
    const room = rooms[roomId];
    if (!room) return;

    const currentPlayerId = room.players[room.currentTurnIndex]?.id;
    if (socket.id !== currentPlayerId) {
      socket.emit('notYourTurn');
      return;
    }

    // Track flipped cards for this player
    flippedCardsMap[socket.id].push(cardIndex);

    io.to(roomId).emit('cardFlipped', { cardIndex, by: socket.id });

    if (flippedCardsMap[socket.id].length === 2) {
      const [firstIndex, secondIndex] = flippedCardsMap[socket.id];

      if (checkMatch(room, firstIndex, secondIndex)) {
        flippedCardsMap[socket.id] = [];
        io.to(roomId).emit('matchFound', { cards: [firstIndex, secondIndex] });
      } else {
        socket.emit('showPopup', "No match. Your turn is over. Choose an action.");
      
        setTimeout(() => {
          io.to(roomId).emit('flipBackCards', { cards: [firstIndex, secondIndex] });
          flippedCardsMap[socket.id] = [];
          // DO NOT auto change turn here — wait for passTurn event from client
        }, 1000);
      }
    }
  });

  socket.on('passTurn', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.players[room.currentTurnIndex].id !== socket.id) return;

    const nextPlayerId = getNextTurn(roomId);
    io.to(roomId).emit('turnChanged', nextPlayerId);
  });

  socket.on('correctWordGuess', ({ roomId, guess, score }) => {
    io.to(roomId).emit('updateScore', { playerId: socket.id, score });
  });

  socket.on('wrongWordGuess', ({ roomId, guess, score }) => {
    io.to(roomId).emit('updateScore', { playerId: socket.id, score });
    const nextPlayerId = getNextTurn(roomId);
    io.to(roomId).emit('turnChanged', nextPlayerId);
  });

  socket.on('wrongImageGuess', ({ roomId, guess, score }) => {
    io.to(roomId).emit('updateScore', { playerId: socket.id, score });
    const nextPlayerId = getNextTurn(roomId);
    io.to(roomId).emit('turnChanged', nextPlayerId);
  });

  socket.on('gameOver', ({ roomId, winnerId }) => {
    io.to(roomId).emit('gameOver', { winnerId });
    if (rooms[roomId]) {
      rooms[roomId].currentTurnIndex = -1;
      rooms[roomId].deck = generateShuffledDeck(); // Reset deck
    }
  });

  socket.on('revealEnded', ({ roomId }) => {
    // Optional: log or notify
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnected:', socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          delete rooms[roomId];
          continue;
        }
        if (room.currentTurnIndex >= room.players.length) {
          room.currentTurnIndex = room.players.length - 1;
        }

        io.to(roomId).emit('updatePlayers', getPlayerNamesMap(roomId));

        // If disconnected player was current turn player, pass turn
        if (room.players[room.currentTurnIndex]?.id === socket.id) {
          const nextPlayerId = getNextTurn(roomId);
          io.to(roomId).emit('turnChanged', nextPlayerId);
        }
      }
    }
  });
});

server.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
});
