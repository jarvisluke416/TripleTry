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


app.use(express.static('public'));


const rooms = {};
const COLS = 50;
const ROWS = 20;
const TOTAL_CARDS = COLS * ROWS;


function generateShuffledDeck() {
    const baseSymbols = [];
    // Define safe Unicode ranges for symbols
    const symbolRanges = [
        { start: 0x2600, end: 0x26FF }, // Miscellaneous Symbols (e.g., ☀, ★)
        { start: 0x2700, end: 0x27BF }, // Dingbats (e.g., ✂, ✔)
        { start: 0x1F600, end: 0x1F64F }, // Emoticons (e.g., 😃, 😄)
        { start: 0x1F300, end: 0x1F5FF }, // Miscellaneous Symbols and Pictographs (e.g., 🌍, 🎉)
    ];


    let symbolCount = 0;
    for (const range of symbolRanges) {
        for (let code = range.start; code <= range.end && symbolCount < TOTAL_CARDS / 2; code++) {
            // Skip surrogate pairs and unrenderable characters
            if (code < 0xD800 || code > 0xDFFF) {
                baseSymbols.push(String.fromCodePoint(code));
                symbolCount++;
            }
        }
    }


    // If we need more symbols, generate fallback alphanumeric symbols
    for (let i = symbolCount; i < TOTAL_CARDS / 2; i++) {
        baseSymbols.push(`S${i}`);
    }


    const fullDeck = [...baseSymbols, ...baseSymbols];
    for (let i = fullDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [fullDeck[i], fullDeck[j]] = [fullDeck[j], fullDeck[i]];
    }
    return fullDeck;
}


function removeWordFromLayout(room, guess, roomId) {
    const grid = room.wordLayout;
    const directions = [
        { name: 'horizontal', dr: 0, dc: 1 },
        { name: 'vertical', dr: 1, dc: 0 },
        { name: 'diag-down-right', dr: 1, dc: 1 },
        { name: 'diag-down-left', dr: 1, dc: -1 },
        { name: 'diag-up-right', dr: -1, dc: 1 },
        { name: 'diag-up-left', dr: -1, dc: -1 },
    ];


    if (!room.guessedWords) room.guessedWords = new Set();
    if (room.guessedWords.has(guess)) {
        console.log(`Word "${guess}" already guessed in room ${roomId}.`);
        return false;
    }


    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            for (const { dr, dc } of directions) {
                let found = true;
                const wordLen = guess.length;
                // Check if word fits in this direction from this start point
                if ((dr === 1 && row + wordLen > ROWS) ||
                    (dr === -1 && row - wordLen < -1) ||
                    (dc === 1 && col + wordLen > COLS) ||
                    (dc === -1 && col - wordLen < -1)) {
                    continue; // Word goes out of bounds
                }


                let currentWord = '';
                for (let i = 0; i < wordLen; i++) {
                    const r = row + dr * i;
                    const c = col + dc * i;
                    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || grid[r][c] !== guess[i]) {
                        found = false;
                        break;
                    }
                    currentWord += grid[r][c]; // Build the word from the grid
                }


                if (found && currentWord === guess) { // Ensure the built word matches the guess
                    for (let i = 0; i < wordLen; i++) {
                        const r = row + dr * i;
                        const c = col + dc * i;
                        grid[r][c] = ''; // Remove the word by setting cells to empty string
                    }
                    room.guessedWords.add(guess);
                    console.log(`Removed word "${guess}" from (${row}, ${col}) in direction ${dr},${dc} in room ${roomId}.`);
                    return true;
                }
            }
        }
    }
    console.log(`Word "${guess}" not found in grid for room ${roomId}.`);
    return false;
}




function getNextTurn(roomId) {
    const room = rooms[roomId];
    if (!room || room.players.length === 0) return null;
    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    return room.players[room.currentTurnIndex]?.id || null;
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


// Stores scores per player in each room
const playerScores = {}; // { roomId: { playerId: score, ... }, ... }


// Stores currently flipped cards by each player
const flippedCardsMap = {}; // { socketId: [cardIndex1, cardIndex2], ... }

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);
    socket.on('joinRoom', ({ roomId, playerName }) => {
        try {
            socket.join(roomId);


            if (!rooms[roomId]) {
                rooms[roomId] = {
                    players: [],
                    currentTurnIndex: -1,
                    deck: null,
                    wordLayout: null,
                    guessedWords: new Set(),
                };
                playerScores[roomId] = {}; // Initialize scores for the new room
                socket.emit('youAreFirstPlayer', { roomId });
                console.log(`${socket.id} is the first player in room ${roomId} and prompted to generate words.`);
            }


            const playerLabel = playerName || `Player_${socket.id.substring(0, 4)}`;
            const existing = rooms[roomId].players.find(p => p.id === socket.id);


            if (!existing) {
                rooms[roomId].players.push({ id: socket.id, name: playerLabel });
                playerScores[roomId][socket.id] = 0; // Initialize score for new player
            }


            // Send existing game state to new player
            if (rooms[roomId].wordLayout) {
                socket.emit('setWordGrid', rooms[roomId].wordLayout);
                console.log(`Sending existing word layout to new player ${socket.id} in room ${roomId}.`);
            }


            if (rooms[roomId].deck) {
                socket.emit('gameDeck', rooms[roomId].deck);
                console.log(`Sending existing game deck to new player ${socket.id} in room ${roomId}.`);
            }


            io.to(roomId).emit('updatePlayers', rooms[roomId].players); // Send full player objects for names
            io.to(roomId).emit('initialScores', playerScores[roomId]); // Send all current scores


            if (rooms[roomId].currentTurnIndex === -1 && rooms[roomId].players.length > 0) {
                rooms[roomId].currentTurnIndex = 0;
                const firstPlayerId = rooms[roomId].players[0].id;
                io.to(roomId).emit('turnChanged', firstPlayerId);
                console.log(`First turn set for ${rooms[roomId].players[0].name} in room ${roomId}.`);
            } else if (rooms[roomId].players.length > 0) {
                const currentTurnId = rooms[roomId].players[rooms[roomId].currentTurnIndex]?.id;
                if (currentTurnId) socket.emit('turnChanged', currentTurnId);
            }


            flippedCardsMap[socket.id] = [];
            console.log(`${playerLabel} (${socket.id}) joined ${roomId}`);
        } catch (err) {
            console.error(`Error in joinRoom for ${socket.id}:`, err);
        }
    });


    socket.on('requestScores', ({ roomId }) => {
        if (playerScores[roomId]) {
            socket.emit('initialScores', playerScores[roomId]);
            console.log(`Sent initial scores to ${socket.id} for room ${roomId}.`);
        }
    });


    socket.on('sendWordLayout', ({ roomId, wordLayout }) => {
        try {
            if (!rooms[roomId] || rooms[roomId].wordLayout) {
                console.warn(`Word layout already exists or room ${roomId} not found. Ignoring layout from ${socket.id}.`);
                return;
            }
            if (!Array.isArray(wordLayout) || wordLayout.length !== ROWS || !wordLayout.every(row => Array.isArray(row) && row.length === COLS)) {
                console.warn(`Invalid word layout from ${socket.id} for room ${roomId}.`);
                return;
            }
            rooms[roomId].wordLayout = wordLayout.map(row => [...row]);
            console.log(`Received word layout from ${socket.id} for room ${roomId}. Broadcasting.`);
            io.to(roomId).emit('setWordGrid', rooms[roomId].wordLayout);
            rooms[roomId].deck = generateShuffledDeck();
            io.to(roomId).emit('gameDeck', rooms[roomId].deck);
        } catch (err) {
            console.error(`Error in sendWordLayout for ${socket.id}:`, err);
        }
    });


    socket.on('revealStarted', ({ roomId }) => {
        console.log(`Server: Reveal started by ${socket.id} in room ${roomId}. Broadcasting 'revealStarted'.`);
        io.to(roomId).emit('revealStarted');
    });


    socket.on('revealEnded', ({ roomId }) => {
        console.log(`Server: Reveal ended by ${socket.id} in room ${roomId}. Broadcasting 'revealEnded'.`);
        io.to(roomId).emit('revealEnded');
    });


    socket.on('flipCard', ({ roomId, cardIndex }) => {
      try {
          const room = rooms[roomId];
          if (!room || !room.deck) {
              console.warn(`Attempted to flip card in invalid or uninitialized room: ${roomId}`);
              return;
          }
          const currentPlayerId = room.players[room.currentTurnIndex]?.id;
          if (socket.id !== currentPlayerId) {
              socket.emit('notYourTurn');
              console.warn(`Player ${socket.id} tried to flip card but it's not their turn in room ${roomId}.`);
              return;
          }

          if (flippedCardsMap[socket.id].length >= 2) {
              console.warn(`Player ${socket.id} tried to flip a third card before processing previous two.`);
              return;
          }

          flippedCardsMap[socket.id].push(cardIndex);
          io.to(roomId).emit('cardFlipped', { cardIndex, by: socket.id });
          console.log(`Card ${cardIndex} flipped by ${socket.id} in room ${roomId}. Flipped: ${flippedCardsMap[socket.id].join(', ')}`);


          if (flippedCardsMap[socket.id].length === 2) {
              const [firstIndex, secondIndex] = flippedCardsMap[socket.id];
              const isMatch = room.deck[firstIndex] === room.deck[secondIndex];

              if (isMatch) {
                  // Match found, keep the turn for this player
                  flippedCardsMap[socket.id] = []; // Clear for next match attempt
                  io.to(roomId).emit('cardsMatched', [firstIndex, secondIndex]);
                  console.log(`Cards ${firstIndex}, ${secondIndex} matched by ${socket.id} in room ${roomId}.`);

                  // --- START OF NEW/MODIFIED CODE FOR MATCHING ---
                  const pointsAwarded = 50; // Define points for a match
                  playerScores[roomId][socket.id] = (playerScores[roomId][socket.id] || 0) + pointsAwarded;
                  io.to(roomId).emit('updateScore', { playerId: socket.id, score: playerScores[roomId][socket.id] });
                  io.to(roomId).emit('matchScored', { playerId: socket.id, points: pointsAwarded }); // New event for popup
                  console.log(`Player ${socket.id} scored ${pointsAwarded} for a match in room ${roomId}. New score: ${playerScores[roomId][socket.id]}`);
                  // --- END OF NEW/MODIFIED CODE FOR MATCHING ---

              } else {
                  // Mismatch, signal client to show popup
                  io.to(roomId).emit('cardsUnmatched', { cardsToFlipBack: [firstIndex, secondIndex] });
                  flippedCardsMap[socket.id] = [];
                  console.log(`Cards ${firstIndex}, ${secondIndex} mismatched by ${socket.id} in room ${roomId}. Prompting action.`);
              }
          }
      } catch (err) {
          console.error(`Error in flipCard for ${socket.id}:`, err);
      }
  });
        socket.on('passTurn', ({ roomId }) => {
        try {
            const room = rooms[roomId];
            if (!room || room.players.length === 0 || room.players[room.currentTurnIndex]?.id !== socket.id) {
                console.warn(`Invalid pass turn attempt by ${socket.id} in room ${roomId}.`);
                return;
            }
            const nextPlayerId = getNextTurn(roomId);
            if (nextPlayerId) {
                io.to(roomId).emit('turnChanged', nextPlayerId);
                console.log(`Turn passed in room ${roomId} to ${nextPlayerId}.`);
            }
        } catch (err) {
            console.error(`Error in passTurn for ${socket.id}:`, err);
        }
    });


    socket.on('submitWordGuess', ({ roomId, guess }) => {
        try {
            const room = rooms[roomId];
            if (!room || !room.wordLayout) {
                console.warn(`Invalid room or wordLayout for submitWordGuess in ${roomId}.`);
                socket.emit('guessResult', { valid: false, message: 'Invalid room or grid.' });
                return;
            }
            const currentScore = playerScores[roomId][socket.id] || 0;
            let message = '';
            let newScore = currentScore;
            let turnOver = true; // Assume turn ends unless specified


            if (removeWordFromLayout(room, guess, roomId)) {
                newScore += 100; // Correct word guess
                message = `✅ Correct! You found "${guess}". +100 points!`;
                turnOver = false; // Player gets to go again after correct word guess
                io.to(roomId).emit('setWordGrid', room.wordLayout); // Update grid for all
                console.log(`Correct word guess "${guess}" by ${socket.id} in room ${roomId}. New score: ${newScore}.`);
                // Notify other players in the room about the scored word
                socket.to(roomId).emit('wordScored', {
                playerId: socket.id,
                word: guess,
                points: 100
              });


                // Check if all words are guessed
                const hasLetters = room.wordLayout.some(row => row.some(cell => cell !== ''));
                if (!hasLetters) {
                    io.to(roomId).emit('gameOver', { winnerId: socket.id });
                    console.log(`Room ${roomId} grid is empty. Game over.`);
                    return; // Exit as game is over
                }


            } else {
                newScore -= 0; // Word not found or already guessed, no score change, just lose turn
                message = `❌ Incorrect word guess for "${guess}". Turn over.`;
                console.log(`Incorrect word guess "${guess}" by ${socket.id} in room ${roomId}. Score: ${newScore}.`);
            }


            playerScores[roomId][socket.id] = newScore;
            io.to(roomId).emit('updateScore', { playerId: socket.id, score: newScore });
            socket.emit('guessResult', { valid: (newScore > currentScore), message, score: newScore, turnOver });


            if (turnOver) { // If turn ends, pass it
                const nextPlayerId = getNextTurn(roomId);
                if (nextPlayerId) {
                    io.to(roomId).emit('turnChanged', nextPlayerId);
                    console.log(`Turn passed after guess by ${socket.id} to ${nextPlayerId} in room ${roomId}.`);
                }
            } else {
                // If turn does NOT end (correct word guess), re-emit turnChanged to current player
                io.to(roomId).emit('turnChanged', socket.id);
                console.log(`Player ${socket.id} retains turn after correct word guess.`);
            }


        } catch (err) {
            console.error(`Error in submitWordGuess for ${socket.id}:`, err);
        }
    });


    socket.on('submitImageGuess', ({ roomId, guess }) => {
        try {
            const room = rooms[roomId];
            if (!room) {
                console.warn(`Invalid room for submitImageGuess in ${roomId}.`);
                socket.emit('guessResult', { valid: false, message: 'Invalid room.' });
                return;
            }
            const pictureAnswer = "TIMOTHY LEARY"; // Define on server for security
            const currentScore = playerScores[roomId][socket.id] || 0;
            let message = '';
            let newScore = currentScore;
            let gameOver = false;


            if (guess === pictureAnswer) {
                newScore += 10000;
                message = `🎉 You named the picture! "${pictureAnswer}". +10,000 points! Game Over!`;
                gameOver = true;
                console.log(`Correct image guess by ${socket.id} in room ${roomId}. Game Over.`);
            } else {
                newScore -= 1000;
                message = `❌ Wrong picture guess for "${guess}". -1000 points. Turn over.`;
                console.log(`Incorrect image guess by ${socket.id} in room ${roomId}. New score: ${newScore}.`);
            }


            playerScores[roomId][socket.id] = newScore;
            io.to(roomId).emit('updateScore', { playerId: socket.id, score: newScore });
            socket.emit('guessResult', { valid: gameOver, message, score: newScore, turnOver: !gameOver });


            if (gameOver) {
                io.to(roomId).emit('gameOver', { winnerId: socket.id });
                // Reset room state here as well, similar to 'gameOver' handler
                if (rooms[roomId]) {
                    rooms[roomId].currentTurnIndex = -1;
                    rooms[roomId].deck = null;
                    rooms[roomId].wordLayout = null;
                    rooms[roomId].guessedWords = new Set();
                    console.log(`Game over and room ${roomId} state reset due to correct image guess.`);
                }
            } else {
                const nextPlayerId = getNextTurn(roomId);
                if (nextPlayerId) {
                    io.to(roomId).emit('turnChanged', nextPlayerId);
                    console.log(`Turn passed after wrong image guess by ${socket.id} to ${nextPlayerId} in room ${roomId}.`);
                }
            }
        } catch (err) {
            console.error(`Error in submitImageGuess for ${socket.id}:`, err);
        }
    });


    socket.on('disconnect', () => {
        console.log('Disconnected:', socket.id);
        try {
            for (const roomId in rooms) {
                const room = rooms[roomId];
                const idx = room.players.findIndex(p => p.id === socket.id);
                if (idx !== -1) {
                    room.players.splice(idx, 1);
                    delete playerScores[roomId][socket.id]; // Remove player's score
                    console.log(`Player ${socket.id} removed from room ${roomId}.`);


                    if (room.players.length === 0) {
                        delete rooms[roomId];
                        delete playerScores[roomId]; // Delete room scores if room is empty
                        console.log(`Room ${roomId} is now empty and deleted, including scores.`);
                        continue;
                    }
                    if (room.currentTurnIndex >= room.players.length) {
                        room.currentTurnIndex = 0; // Adjust index if current player was last
                    }
                    io.to(roomId).emit('updatePlayers', room.players); // Send full player objects
                    io.to(roomId).emit('initialScores', playerScores[roomId]); // Send updated scores
                   
                    if (room.players.length > 0) {
                        // If the disconnected player was the current turn, pass the turn
                        const currentTurnPlayerId = room.players[room.currentTurnIndex]?.id;
                        if (!currentTurnPlayerId || currentTurnPlayerId === socket.id) { // Check if the turn holder is no longer valid or was the disconnected player
                            const nextPlayerId = getNextTurn(roomId);
                            if (nextPlayerId) {
                                io.to(roomId).emit('turnChanged', nextPlayerId);
                                console.log(`Disconnected player ${socket.id} was current turn. Turn passed to ${nextPlayerId} in room ${roomId}.`);
                            }
                        } else {
                            // If the current turn player is still valid, ensure they know it's still their turn
                            io.to(roomId).emit('turnChanged', currentTurnPlayerId);
                        }
                    }
                }
            }
            delete flippedCardsMap[socket.id]; // Clear any pending flips for this disconnected player
        } catch (err) {
            console.error(`Error in disconnect for ${socket.id}:`, err);
        }
    });
});

// Periodic cleanup of empty rooms
setInterval(() => {
    for (const roomId in rooms) {
        if (rooms[roomId].players.length === 0) {
            delete rooms[roomId];
            delete playerScores[roomId]; // Also delete associated scores
            console.log(`Cleaned up empty room ${roomId} and its scores.`);
        }
    }
}, 600000); // 10 minutes

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
