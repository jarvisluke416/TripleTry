// index.js
const socket = io();
const roomId = 'room1';


let isFirstPlayerInRoom = false;


// --- MODIFIED: This function is now async, and it calls placeWords() ---
socket.on('youAreFirstPlayer', async () => {
    isFirstPlayerInRoom = true;
    console.log("Socket Event: youAreFirstPlayer - This client is the first player. Generating words...");


    // *** IMPORTANT CHANGE: Only the first player generates and sends the words ***
    try {
        await placeWords(); // Call placeWords() here to generate the grid
        console.log("First player: Words generated and sent to server.");
        createLetterCells(); // Render the newly generated grid
    } catch (error) {
        console.error("Error generating words for first player:", error);
    }
});


let gameBoard;
let wordLayer;
let revealOverlay;
let startScreen;
let startBtn;
let nameInput;
let gameScreenContainer;
let screenName = '';
let revealActive = false;
let isPlayerTurn = false;
let allowFlip = false;
let currentScore = 0;
const pictureAnswer = "TIMOTHY LEARY";
let flippedCards = [];
let canUseReveal = true; // <-- Added: control Ctrl+V usage




const COLS = 50;
const ROWS = 20;
const CARD_WIDTH = 2; // vw
const CARD_HEIGHT = 5; // vh
const playerScores = {}; // Track scores for each player




// --- Word logic ---
async function fetchRandomWords(count = 1000) {
    try {
        const response = await fetch(`https://random-word-api.herokuapp.com/word?number=${count}`);
        const words = await response.json();
        const filteredWords = words
            .map(w => w.toUpperCase())
            .filter(w => /^[A-Z]+$/.test(w) && w.length >= 5 && w.length <= 15);
        console.log(`Fetched ${words.length} words, filtered to ${filteredWords.length} valid words.`);
        return filteredWords;
    } catch (err) {
        console.error("Word API error:", err);
        return [];
    }
}
const BUFFER_SIZE = 0; // Keeping this at 0. Consider increasing to 1 or 2 for more spacing.
const directions = ['horizontal', 'vertical', 'diag-down-right', 'diag-down-left', 'diag-up-right', 'diag-up-left'];
// Initialize hiddenLetters and bufferGrid here,
// but ensure they are reset in placeWords for each new game.
let hiddenLetters = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => '')
);
let bufferGrid = Array.from({ length: ROWS }, () => // Changed to 'let' for full re-assignment in placeWords
    Array.from({ length: COLS }, () => false)
);
// --- CORRECTED canPlaceWord function with debug logs ---
function canPlaceWord(word, row, col, dir) {
    const drdc = {
        'horizontal': [0, 1],
        'vertical': [1, 0],
        'diag-down-right': [1, 1],
        'diag-down-left': [1, -1],
        'diag-up-right': [-1, 1],
        'diag-up-left': [-1, -1],
    };
    const [dr, dc] = drdc[dir];
    // First pass: Check if the word's letters would be out of bounds or overlap existing letters
    for (let i = 0; i < word.length; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        // Check grid boundaries for the word's actual letters
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) {
            // console.log(`canPlaceWord: "${word}" (len ${word.length}) FAIL - Out of bounds at (${r},${c}) for char ${i} in direction ${dir}.`);
            return false;
        }
        // Check for direct overlap with an already placed letter in hiddenLetters
        if (hiddenLetters[r][c] !== '') {
            // console.log(`canPlaceWord: "${word}" (len ${word.length}) FAIL - Overlap with existing letter '${hiddenLetters[r][c]}' at (${r},${c}) for char ${i} in direction ${dir}.`);
            return false;
        }
    }
    // Second pass: Check the buffer zone around the *entire* proposed word placement.
    for (let i = -BUFFER_SIZE; i < word.length + BUFFER_SIZE; i++) {
        for (let rr = -BUFFER_SIZE; rr <= BUFFER_SIZE; rr++) {
            for (let cc = -BUFFER_SIZE; cc <= BUFFER_SIZE; cc++) {
                // Calculate the actual grid coordinates of the current cell being checked
                const checkR = row + dr * i + rr;
                const checkC = col + dc * i + cc;
                // Ensure the check cell is within grid boundaries
                if (checkR >= 0 && checkR < ROWS && checkC >= 0 && checkC < COLS) {
                    // Critical: DO NOT consider the current word's *own* proposed letter cells as conflicts
                    const isProposedWordCell = (i >= 0 && i < word.length && rr === 0 && cc === 0);
                    if (!isProposedWordCell && bufferGrid[checkR][checkC]) {
                        // console.log(`canPlaceWord: "${word}" (len ${word.length}) FAIL - Buffer conflict at (${checkR},${checkC}). Proposed Word cell: ${isProposedWordCell} for direction ${dir}.`);
                        return false;
                    }
                }
            }
        }
    }
    return true; // No conflicts found, word can be placed
}


// --- CORRECTED placeWord function ---
function placeWord(word, startRow, startCol, direction) {
    const drdc = {
        'horizontal': [0, 1],
        'vertical': [1, 0],
        'diag-down-right': [1, 1],
        'diag-down-left': [1, -1],
        'diag-up-right': [-1, 1],
        'diag-up-left': [-1, -1],
    };
    const [dr, dc] = drdc[direction];
    // Mark the letter cells in hiddenLetters and bufferGrid first
    for (let i = 0; i < word.length; i++) {
        const r = startRow + dr * i;
        const c = startCol + dc * i;
        hiddenLetters[r][c] = word[i];
        bufferGrid[r][c] = true; // Mark the actual letter cell as occupied in bufferGrid
    }




    // Now, mark the buffer zone cells around the word.
    for (let i = -BUFFER_SIZE; i < word.length + BUFFER_SIZE; i++) {
        for (let rr = -BUFFER_SIZE; rr <= BUFFER_SIZE; rr++) {
            for (let cc = -BUFFER_SIZE; cc <= BUFFER_SIZE; cc++) {
                const r = startRow + dr * i + rr;
                const c = startCol + dc * i + cc;




                // Check bounds for the buffer cell
                if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
                    const isWordCell = (i >= 0 && i < word.length && rr === 0 && cc === 0);
                    if (!isWordCell) { // Only mark if it's NOT a letter cell of the current word
                        bufferGrid[r][c] = true;
                    }
                }
            }
        }
    }
}




// Utility: Shuffle an array in-place
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}




// --- The complete placeWords function (No changes needed inside this function) ---
async function placeWords() {
    console.log("--- Starting placeWords function ---");
    console.log("Initial hiddenLetters (before reset):", hiddenLetters);
    console.log("Initial bufferGrid (before reset):", bufferGrid);




    let words = (await fetchRandomWords(500)) // Use the fetchRandomWords function
        .filter(w => w.length <= COLS && w.length <= ROWS); // Simple filter, adjust if needed




    console.log(`Words after fetch and initial filter (${words.length} words):`, words.slice(0, 10)); // Log first 10 words
    words.sort((a, b) => b.length - a.length);
    shuffleArray(words);
    console.log("Words after sorting and shuffling (first 10):", words.slice(0, 10));
    // --- CRITICAL RESET CHECK ---
    // Re-initialize hiddenLetters and bufferGrid with completely new arrays
    hiddenLetters = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
    bufferGrid = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    console.log("hiddenLetters after full reset (should be all empty):", hiddenLetters);
    console.log("bufferGrid after full reset (should be all false):", bufferGrid);
    const maxAttemptsPerWord = 50;
    let placedCount = 0;
    let failedWords = [];
    for (const word of words) {
        let placed = false;
        // console.log(`Attempting to place "${word}" (len: ${word.length})`); // Uncomment for very detailed per-word trace
        for (let attempt = 0; attempt < maxAttemptsPerWord; attempt++) {
            const dir = directions[Math.floor(Math.random() * directions.length)];
            const drdc = {
                'horizontal': [0, 1],
                'vertical': [1, 0],
                'diag-down-right': [1, 1],
                'diag-down-left': [1, -1],
                'diag-up-right': [-1, 1],
                'diag-up-left': [-1, -1],
            };
            const [dr, dc] = drdc[dir];
            // Calculate min/max starting coordinates for the current word and direction
            let minStartRow, maxStartRow, minStartCol, maxStartCol;
            // Calculate row bounds
            if (dr === 0) { // Horizontal word: can start anywhere in any row
                minStartRow = 0;
                maxStartRow = ROWS - 1;
            } else if (dr === 1) { // Downward movement
                minStartRow = 0;
                maxStartRow = ROWS - 1 - (word.length - 1);
            } else { // dr === -1 (Upward movement)
                minStartRow = word.length - 1;
                maxStartRow = ROWS - 1;
            }
            // Calculate column bounds
            if (dc === 0) { // Vertical word
                minStartCol = 0;
                maxStartCol = COLS - 1;
            } else if (dc === 1) { // Rightward movement
                minStartCol = 0;
                maxStartCol = COLS - 1 - (word.length - 1);
            } else { // dc === -1 (Leftward movement)
                minStartCol = word.length - 1;
                maxStartCol = COLS - 1;
            }
            // Ensure min <= max after clamping
            minStartRow = Math.max(0, minStartRow);
            maxStartRow = Math.min(ROWS - 1, maxStartRow);
            minStartCol = Math.max(0, minStartCol);
            maxStartCol = Math.min(COLS - 1, maxStartCol);
            // If the calculated range is invalid (min > max), it means no valid placement is possible
            if (minStartRow > maxStartRow || minStartCol > maxStartCol) {
                // console.log(`     Skipping attempt ${attempt}: Invalid bounds for "${word}" (len ${word.length}) in ${dir}. Bounds: [${minStartRow},${maxStartRow}]x[${minStartCol},${maxStartCol}]`);
                continue; // Skip this attempt, try another random direction/position
            }
            // Pick a random starting point within the VALID limits for this word and direction
            const startRow = Math.floor(Math.random() * (maxStartRow - minStartRow + 1)) + minStartRow;
            const startCol = Math.floor(Math.random() * (maxStartCol - minStartCol + 1)) + minStartCol;
            // console.log(`     Attempt ${attempt} for "${word}" (len ${word.length}): Trying at (${startRow}, ${startCol}) in ${dir}. Valid bounds: [${minStartRow},${maxStartRow}]x[${minStartCol},${maxStartCol}]`);
            if (canPlaceWord(word, startRow, startCol, dir)) {
                placeWord(word, startRow, startCol, dir);
                placedCount++;
                placed = true;
                console.log(`     ✅ Successfully placed "${word}" at (${startRow}, ${startCol}) in ${dir}.`);
                break; // Word placed, move to the next word
            } else {
                // console.log(`     ❌ Failed to place "${word}" at (${startRow}, ${startCol}) in ${dir}. Conflict detected.`);
            }
        }
        if (!placed) {
            failedWords.push(word); // Word couldn't be placed after maxAttemptsPerWord
            // console.log(`     ❌ Failed to place "${word}" after ${maxAttemptsPerWord} attempts. Adding to failed list.`);
        }
    }
    console.log(`--- Finished placeWords function ---`);
    console.log(`✅ Placed ${placedCount} words out of ${words.length} attempted.`);
    console.log(`❌ Failed to place ${failedWords.length} words:`, failedWords);
    console.log("Final hiddenLetters grid:");
    console.table(hiddenLetters); // Display the final grid of letters
    console.log("Final bufferGrid (true = occupied/buffered, false = empty):");
    console.table(bufferGrid);   // Display the final buffer grid (useful for debugging spacing)
    // Only send the layout to the server if this client is the first player
    if (isFirstPlayerInRoom) {
        console.log("This is the first player, sending wordLayout to server.");
        socket.emit('sendWordLayout', {
            roomId,
            wordLayout: hiddenLetters,
        });
    } else {
        console.log("This is not the first player, waiting for wordLayout from server.");
    }
}
// --- Card logic ---
function createCards(deck) {
    gameBoard.innerHTML = '';
    console.log("Creating cards for deck:", deck.length, "cards.");
    deck.forEach((symbol, index) => {
        const card = document.createElement("div");
        card.className = "card";
        card.dataset.symbol = symbol;
        card.dataset.index = index;
        const row = Math.floor(index / COLS);
        const col = index % COLS;
        card.style.left = `${col * CARD_WIDTH}vw`;
        card.style.top = `${row * CARD_HEIGHT}vh`;


        const back = document.createElement("div");
        back.className = "card-inner card-back";


        const front = document.createElement("div");
        front.className = "card-inner card-front";
        front.textContent = symbol; // Use textContent to avoid escaping


        card.appendChild(back);
        card.appendChild(front);


        card.addEventListener("click", () => {
            if (!isPlayerTurn || !allowFlip || revealActive) {
                return;
            }
            if (card.classList.contains("flipped") || card.classList.contains("removed") || flippedCards.length === 2) {
                return;
            }
            console.log(`Player clicked card at index: ${index}`);
            socket.emit('flipCard', { roomId, cardIndex: index });
        });
        gameBoard.appendChild(card);
    });
    console.log("Finished creating cards.");
}
// --- Reveal logic ---
function flipAllCards(flip = true, hideFront = false) {
    console.log(`Toggling all cards flip state to: ${flip}, hideFront: ${hideFront}`);
    const allCards = document.querySelectorAll('.card:not(.removed)');
    allCards.forEach(card => {
        if (flip) {
            card.classList.add('flipped');
            if (hideFront) card.classList.add('hide-front');
        } else {
            card.classList.remove('flipped');
            card.classList.remove('hide-front');
        }
    });
}


document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        console.log("Ctrl+V pressed.");
        if (!canUseReveal || revealActive) {
            console.log("Reveal not allowed yet (either canUseReveal is false or revealActive is true).");
            return;
        }
        canUseReveal = false;
        revealActive = true;
        console.log("Activating reveal: canUseReveal = false, revealActive = true.");
        gameBoard.classList.add('hide-background');
        flipAllCards(true);
        socket.emit('revealStarted', { roomId }); // Tell server reveal started
        setTimeout(() => {
            console.log("Reveal timer 1 (10s) finished. Flipping cards back.");
            flipAllCards(false);
            setTimeout(() => {
                console.log("Reveal timer 2 (1s) finished. Restoring game board.");
                gameBoard.classList.remove('hide-background');
                if (revealOverlay) revealOverlay.style.display = 'none';
                revealActive = false;
                socket.emit('revealEnded', { roomId }); // Tell server reveal ended
                console.log("Reveal ended: revealActive = false, emit revealEnded.");
            }, 1000);
        }, 10000);
    }
});
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key.toLowerCase() === 'c' && revealActive) {
      console.log("Ctrl+C pressed during reveal – activating full word view!");
      // Hide all cards
      const allCards = document.querySelectorAll('.card');
      allCards.forEach(card => card.classList.add('hidden'));
      // Show all letters
      gameScreenContainer.classList.add('show-all-letters');
      // Display the word layer on top
      if (wordLayer) {
          wordLayer.style.opacity = "1";
          wordLayer.style.zIndex = "1000";
          console.log("Word layer made visible.");
      }
      // Ensure letter cells are created
      createLetterCells();
      // Set letter cell backgrounds to solid white
      const letterCells = document.querySelectorAll('.letter-cell');
      letterCells.forEach(cell => {
          cell.style.backgroundColor = 'white';
      });


      // Automatically revert after 10 seconds
      setTimeout(() => {
          console.log("Full word view timer (10s) finished. Hiding word view.");


          // Show cards again
          allCards.forEach(card => card.classList.remove('hidden'));
          gameScreenContainer.classList.remove('show-all-letters');


          // Hide the word layer
          if (wordLayer) {
              wordLayer.style.opacity = "";
              wordLayer.style.zIndex = "";
              console.log("Word layer made invisible.");
          }


          // Reset letter cell backgrounds
          letterCells.forEach(cell => {
              cell.style.backgroundColor = '';
          });


          console.log("Word view hidden, cards and backgrounds restored.");
      }, 10000);
  }
});


// --- Turn notification ---
function showTurnNotification(message) {
    console.log("Showing turn notification:", message);
    let popup = document.getElementById("turn-notification");
    if (!popup) {
        popup = document.createElement("div");
        popup.id = "turn-notification";
        popup.style.cssText = `
            position: fixed;
            top: 60%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.85);
            color: white;
            padding: 20px 40px;
            font-size: 1.5em;
            border-radius: 10px;
            z-index: 10000;
            text-align: center;
        `;
        const text = document.createElement("div");
        text.id = "turn-notification-text";
        popup.appendChild(text);
        document.body.appendChild(popup);
    }
    const text = document.getElementById("turn-notification-text");
    text.textContent = message;
    popup.style.display = "block";
    setTimeout(() => {
        popup.style.display = "none";
        console.log("Turn notification hidden.");
    }, 2000);
}


function showPopup(message) {
  const popup = document.getElementById('notification-popup');
  popup.textContent = message;
  popup.style.display = 'block';
  setTimeout(() => {
    popup.style.display = 'none';
  }, 4000); // Hide after 4 seconds
}




// --- Turn Popup logic ---
// MODIFIED: This function now controls which buttons/input are shown
function showTurnPopup(message = "Your turn is over. Choose an action:") {
    console.log("Showing turn popup with message:", message);
    document.getElementById("popup-message").textContent = message;
    document.getElementById("turn-popup").style.display = "flex";
    // Reset button states
    document.getElementById("pass-btn").style.display = "inline-block";
    document.getElementById("guess-word-btn").style.display = "inline-block";
    document.getElementById("guess-image-btn").style.display = "inline-block";
    document.getElementById("popup-input").style.display = "none";
    document.getElementById("submit-guess-btn").style.display = "none";
    // Clear any previous guess input
    document.getElementById("popup-input").value = "";
    // IMPORTANT: Clear flipped cards when popup appears, as player has to make a choice
    flippedCards = [];
    allowFlip = false; // Prevent further flips until action is chosen
}


function closePopup() {
    console.log("Closing turn popup.");
    document.getElementById("turn-popup").style.display = "none";
    document.getElementById("popup-input").value = "";
    document.getElementById("popup-input").style.display = "none";
    document.getElementById("submit-guess-btn").style.display = "none";
    allowFlip = true; // Re-enable flips for the next turn
}
// --- DEBUGGING createLetterCells function ---
function createLetterCells() {
    const wordLayer = document.getElementById("word-layer");
    if (!wordLayer) {
        console.error("❌ wordLayer element not found in DOM. Cannot create letter cells for debugging.");
        return;
    }
    wordLayer.innerHTML = ''; // Clear previous
    console.log("Creating letter cells for word layer (including visual debugging colors).");




    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const letter = hiddenLetters[row][col];
            // Always create a cell for visual debugging, even if empty
            const letterDiv = document.createElement("div");
            letterDiv.className = "letter-cell";
            letterDiv.dataset.row = row;
            letterDiv.dataset.col = col;
            letterDiv.style.position = 'absolute';
            letterDiv.style.left = `${col * CARD_WIDTH}vw`;
            letterDiv.style.top = `${row * CARD_HEIGHT}vh`;
            letterDiv.style.width = `${CARD_WIDTH}vw`;
            letterDiv.style.height = `${CARD_HEIGHT}vh`;
            letterDiv.style.display = 'flex';
            letterDiv.style.alignItems = 'center';
            letterDiv.style.justifyContent = 'center';
            letterDiv.style.fontSize = '1.5vw';
            letterDiv.style.pointerEvents = 'none'; // Still no pointer events




            // DEBUGGING COLORS:
            if (letter !== '') {
                letterDiv.textContent = letter;
                letterDiv.style.color = 'white'; // Actual letter
                letterDiv.style.backgroundColor = 'rgba(0, 255, 0, 0.3)'; // Light green for actual letter
                letterDiv.style.opacity = '1'; // Make actual letters fully visible
            } else if (bufferGrid[row][col]) {
                letterDiv.textContent = ''; // No text for buffer, just color
                letterDiv.style.color = 'yellow'; // (text color won't show)
                letterDiv.style.backgroundColor = 'rgba(255, 255, 0, 0.1)'; // Light yellow for buffer
                letterDiv.style.opacity = '0.5'; // Make buffers semi-visible
            } else {
                letterDiv.textContent = ''; // Empty cell
                letterDiv.style.backgroundColor = 'rgba(128, 128, 128, 0.05)'; // Very light gray for empty
                letterDiv.style.opacity = '0.2'; // Make empty cells subtly visible
            }
            wordLayer.appendChild(letterDiv);
        }
    }
    console.log("Finished rendering debug letter cells.");
}


document.addEventListener('DOMContentLoaded', () => {
    gameBoard = document.getElementById("game-board");
    wordLayer = document.getElementById("word-layer");
    revealOverlay = document.getElementById('reveal-overlay');
    startScreen = document.getElementById('start-screen');
    startBtn = document.getElementById('start-btn');
    nameInput = document.getElementById('screen-name-input');
    gameScreenContainer = document.getElementById('game-screen-container');
    console.log('✅ DOM Content Loaded. Initializing elements.');
    console.log('Value of wordLayer after DOM loaded:', wordLayer);




    startBtn.onclick = async () => {
        console.log("Start button clicked.");
        if (!nameInput.value.trim()) {
            alert("Please enter a screen name.");
            return;
        }
        screenName = nameInput.value.trim();
        console.log("Screen name set to:", screenName);
        try {
            startScreen.style.display = 'none';
            gameScreenContainer.style.display = 'block';
            console.log("Switched from start screen to game screen.");
            socket.emit('joinRoom', { roomId, playerName: screenName });
            console.log(`Emitted 'joinRoom' for roomId: ${roomId}, playerName: ${screenName}.`);
            initGame();
        } catch (error) {
            console.error("Error during start button handler:", error);
        }
    }
});




// --- Buttons (MODIFIED to handle popup visibility and socket emissions) ---
document.getElementById("pass-btn").onclick = () => {
    console.log("Pass button clicked.");
    if (!isPlayerTurn) {
        console.log("Not player's turn, pass ignored.");
        return;
    }
    closePopup(); // Close the popup
    isPlayerTurn = false;
    allowFlip = false;
    socket.emit('passTurn', { roomId });
    console.log("Emitted 'passTurn'.");
};


// In index.js, update the guess-word-btn handler
document.getElementById("guess-word-btn").onclick = () => {
    console.log("Guess Word button clicked.");
    if (!isPlayerTurn) {
        console.log("Not player's turn, guess ignored.");
        return;
    }
    document.getElementById("popup-input").style.display = "inline-block";
    document.getElementById("submit-guess-btn").style.display = "inline-block";
    // Hide other buttons
    document.getElementById("pass-btn").style.display = "none";
    document.getElementById("guess-image-btn").style.display = "none";
    document.getElementById("submit-guess-btn").onclick = () => {
        const guess = document.getElementById("popup-input").value.toUpperCase();
        console.log("Submitting word guess:", guess);
        if (guess.length > 0) {
            closePopup(); // Close popup immediately after submitting guess
            socket.emit('submitWordGuess', { roomId, guess }); // Emit to server for validation
            console.log(`Emitted 'submitWordGuess' for "${guess}".`);
        } else {
            alert("Please enter a word to guess.");
        }
    };
};


document.getElementById("guess-image-btn").onclick = () => {
    console.log("Guess Image button clicked.");
    if (!isPlayerTurn) {
        console.log("Not player's turn, guess ignored.");
        return;
    }
    document.getElementById("popup-input").style.display = "inline-block";
    document.getElementById("submit-guess-btn").style.display = "inline-block";
    // Hide other buttons
    document.getElementById("pass-btn").style.display = "none";
    document.getElementById("guess-word-btn").style.display = "none";


    document.getElementById("submit-guess-btn").onclick = () => {
        const guess = document.getElementById("popup-input").value.trim().toUpperCase();
        console.log("Submitting image guess:", guess);
        if (guess.length > 0) {
            closePopup(); // Close popup immediately after submitting guess
            socket.emit('submitImageGuess', { roomId, guess }); // Emit to server for validation
            console.log(`Emitted 'submitImageGuess' for "${guess}".`);
        } else {
            alert("Please enter a guess for the picture.");
        }
    };
};


// Update setWordGrid to re-render the board
socket.on('setWordGrid', (grid) => {
    console.log("Socket Event: setWordGrid received from server.");
    // Clear existing grid and push new rows
    hiddenLetters.length = 0;
    grid.forEach(row => hiddenLetters.push([...row]));
    createLetterCells(); // Re-render word layer (for debugging view)
    console.log("hiddenLetters updated and board re-rendered.");
});


// --- Socket Events ---
socket.on('updatePlayers', players => {
    console.log('Socket Event: updatePlayers - Players in room:', players);
    // You might want to update a visible player list here.
});


socket.on('turnChanged', playerId => {
    console.log(`Socket Event: turnChanged - New turn for Player ID: ${playerId}.`);
    isPlayerTurn = (playerId === socket.id);
    allowFlip = isPlayerTurn; // Allow flips if it's your turn
    flippedCards = []; // Clear flipped cards for the new turn
    closePopup(); // Ensure popup is closed when turn changes
    if (isPlayerTurn) {
        canUseReveal = true; // Enable Ctrl+V at start of turn
        console.log("It's your turn. Ctrl+V enabled.");
    } else {
        canUseReveal = false; // Disable for others
        console.log("It's not your turn. Ctrl+V disabled.");
    }
    const message = isPlayerTurn ? "🎯 Your turn!" : "⏳ Waiting for opponent...";
    showTurnNotification(message);
});


socket.on('gameDeck', (deck) => {
    console.log('Socket Event: gameDeck received. Creating cards.');
    createCards(deck);
});


socket.on('cardFlipped', ({ cardIndex }) => {
    console.log(`Socket Event: cardFlipped for index: ${cardIndex}.`);
    const card = document.querySelector(`.card[data-index="${cardIndex}"]`);
    if (card && !card.classList.contains("flipped")) {
        card.classList.add("flipped");
        flippedCards.push(card);
        if (flippedCards.length === 2) {
            allowFlip = false; // Prevent further flips while server processes
            console.log("Two cards flipped, disallowing further flips temporarily.");
        }
    }
});


socket.on('cardsMatched', (cards) => {
    console.log('Socket Event: cardsMatched received! Matched cards:', cards);
    cards.forEach(cardIndex => {
        const card = document.querySelector(`.card[data-index="${cardIndex}"]`);
        if (card) {
            card.classList.add("removed");
            const left = parseFloat(card.style.left);
            const top = parseFloat(card.style.top);
            const col = Math.round(left / CARD_WIDTH);
            const row = Math.round(top / CARD_HEIGHT);
            const letterDiv = document.querySelector(`.letter-cell[data-row="${row}"][data-col="${col}"]`);
            if (letterDiv) {
                letterDiv.classList.add("visible");
                console.log(`Revealed letter at (${row},${col}) for matched card ${cardIndex}.`);
            }
        }
    });
    // Turn remains with the player after a match
    flippedCards = [];
    allowFlip = true;
    canUseReveal = true; // Player can use reveal again after a match
    console.log("Cards matched. Flipped cards reset, allowFlip true, canUseReveal true.");
});


// MODIFIED: This now triggers the popup
socket.on('cardsUnmatched', ({ cardsToFlipBack }) => {
    console.log('Socket Event: cardsUnmatched received! Non-matching cards:', cardsToFlipBack);
    // Show the cards for a brief moment before the popup appears
    cardsToFlipBack.forEach(cardIndex => {
        const card = document.querySelector(`.card[data-index="${cardIndex}"]`);
        if (card && !card.classList.contains("flipped") && !card.classList.contains("removed")) {
            card.classList.add("flipped");
        }
    });


    // Wait a short duration before showing the popup and flipping them back
    setTimeout(() => {
        cardsToFlipBack.forEach(cardIndex => {
            const card = document.querySelector(`.card[data-index="${cardIndex}"]`);
            if (card && card.classList.contains("flipped") && !card.classList.contains("removed")) {
                card.classList.remove("flipped");
            }
        });
        // Now, show the popup to prompt player action
        if (isPlayerTurn) { // Only show popup if it's THIS client's turn
            showTurnPopup("You made a mismatch! Choose your next action:");
        }
        // No turn change here, it's decided by player action via popup buttons
    }, 1000); // Cards remain visible for 1 second before popup appears
});


socket.on('revealStarted', () => {
    console.log('Socket Event: revealStarted from server. Activating reveal visually.');
    revealActive = true;
    if (revealOverlay) revealOverlay.style.display = 'block';
    flipAllCards(true);
});


socket.on('revealEnded', () => {
    console.log('Socket Event: revealEnded from server. Deactivating reveal visually.');
    revealActive = false;
    if (revealOverlay) revealOverlay.style.display = 'none';
    flipAllCards(false);
});


socket.on('updateScore', ({ playerId, score }) => {
  console.log(`Score update: Player ${playerId} now has ${score} points.`);


  // Update stored score
  playerScores[playerId] = score;


  // Update scoreboard display
  const scoreDisplay = document.getElementById('scoreboard');
  if (scoreDisplay) {
      scoreDisplay.innerHTML = '';
      for (const id in playerScores) {
          const name = playerNameMap[id] || `Player ${id}`;
          scoreDisplay.innerHTML += `<p>${name}: ${playerScores[id]}</p>`;
      }
  }
  // Optional: also show the scores in the popup message
  const popupMessage = document.getElementById('popup-message');
  if (popupMessage) {
      popupMessage.innerHTML = `
          You made a mismatch!<br>
          ${Object.entries(playerScores).map(([id, score]) => {
              const name = playerNameMap[id] || `Player ${id}`;
              return `<strong>${name}:</strong> ${score}`;
          }).join('<br>')}<br>
          Choose your next action:
      `;
  }
});

const pointsPopup = document.getElementById('points-popup');

socket.on('matchScored', ({ playerId, points }) => {
    console.log(`Socket Event: matchScored for player ${playerId}, points: ${points}`);

    // Only show the popup to the player who scored
    if (socket.id === playerId) {
        if (pointsPopup) {
            pointsPopup.textContent = `${points}pts!!!`;
            pointsPopup.classList.remove('show'); // Remove to re-trigger animation
            void pointsPopup.offsetWidth; // Trigger reflow to restart animation
            pointsPopup.classList.add('show');
        }
    }
});

socket.on('guessResult', ({ valid, message, score, turnOver }) => {
    console.log('Socket Event: guessResult received:', { valid, message, score, turnOver });
    if (message) {
        alert(message); // Display message to the player
    }
    currentScore = score; // Update client's score based on server
    // Note: Turn change is now handled by 'turnChanged' event which comes separately
    // after the guess (if turnOver is true, server will emit turnChanged).
    closePopup(); // Ensure popup is closed after result
});


socket.on('gameOver', (data) => {
    console.log('Socket Event: gameOver received. Winner ID:', data.winnerId);
    alert(`Game over! Winner: ${playerNameMap[data.winnerId] || data.winnerId}!`);
    // Optionally display final scores before reload
    location.reload(); // Reload the page to restart
});


// To store player names for display
let playerNameMap = {};
socket.on('updatePlayers', players => {
    console.log('Socket Event: updatePlayers - Players in room:', players);
    playerNameMap = {};
    const scoreboard = document.getElementById('scoreboard');
    scoreboard.innerHTML = '<h2>Scores</h2>'; // Clear and re-add title
    players.forEach(p => {
        playerNameMap[p.id] = p.name;
        scoreboard.innerHTML += `<p>${p.name}: <span id="score-${p.id}">0</span></p>`;
        // Initialize player scores to 0 or current known score if available
    });
    // Request score update for newly joined player, or update existing scores
    socket.emit('requestScores', { roomId });
});


// Handle initial score sync or when a player joins and scores are already present
socket.on('initialScores', (scores) => {
    console.log('Socket Event: initialScores received:', scores);
    for (const playerId in scores) {
        const scoreSpan = document.getElementById(`score-${playerId}`);
        if (scoreSpan) {
            scoreSpan.textContent = scores[playerId];
            if (playerId === socket.id) {
                currentScore = scores[playerId]; // Update client's own score
            }
        }
    }
});


socket.on('wordScored', ({ playerId, word, points }) => {
  const name = playerNameMap[playerId] || `Player ${playerId}`;
  if (socket.id !== playerId) { // prevent showing it to the player who scored
    showPopup(`${name} spelled "${word}" and earned ${points} points!`);
  }
});

async function initGame() {
    console.log("initGame called.");
    // This function can remain largely the same, as word generation is now done by the first player
    // and deck/wordLayout are received via socket events.
    // console.log("Letters in grid (after placeWords/setWordGrid):", hiddenLetters.flat().filter(c => c !== ''));
}
