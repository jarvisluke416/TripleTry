const socket = io('http://10.0.0.174:3000');
const roomId = 'room1';

const gameBoard = document.getElementById("game-board");
const wordLayer = document.getElementById("word-layer");
const revealOverlay = document.getElementById('reveal-overlay');

// Screen name UI
const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const nameInput = document.getElementById('screen-name-input');

let screenName = '';
let revealActive = false;
let isPlayerTurn = false;
let allowFlip = false;
let currentScore = 0;
const pictureAnswer = "TIMOTHY LEARY";
let flippedCards = [];

const COLS = 50;
const ROWS = 20;
const CARD_WIDTH = 2; // vw
const CARD_HEIGHT = 5; // vh

const hiddenLetters = Array.from({ length: ROWS }, () =>
  Array.from({ length: COLS }, () => '')
);

// --- Word logic ---
async function fetchRandomWords(count = 200) {
  try {
    const response = await fetch(`https://random-word-api.herokuapp.com/word?number=${count}`);
    const words = await response.json();
    return words
      .map(w => w.toUpperCase())
      .filter(w => /^[A-Z]+$/.test(w) && w.length <= 10);
  } catch (err) {
    console.error("Word API error:", err);
    return [];
  }
}

function canPlaceWord(word, row, col, dir) {
  if (dir === 'horizontal') {
    if (col + word.length > COLS) return false;
    return word.split('').every((ch, i) => hiddenLetters[row][col + i] === '' || hiddenLetters[row][col + i] === ch);
  } else {
    if (row + word.length > ROWS) return false;
    return word.split('').every((ch, i) => hiddenLetters[row + i][col] === '' || hiddenLetters[row + i][col] === ch);
  }
}

function placeWord(word, row, col, dir) {
  for (let i = 0; i < word.length; i++) {
    if (dir === 'horizontal') hiddenLetters[row][col + i] = word[i];
    else hiddenLetters[row + i][col] = word[i];
  }
}

async function placeWords() {
  const words = await fetchRandomWords(300);
  for (const word of words) {
    for (let tries = 0; tries < 100; tries++) {
      const row = Math.floor(Math.random() * ROWS);
      const col = Math.floor(Math.random() * COLS);
      const dir = Math.random() > 0.5 ? 'horizontal' : 'vertical';
      if (canPlaceWord(word, row, col, dir)) {
        placeWord(word, row, col, dir);
        break;
      }
    }
  }
}

function createLetterCells() {
  wordLayer.innerHTML = ''; // Clear existing letters
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const letter = hiddenLetters[row][col];
      if (letter) {
        const div = document.createElement("div");
        div.className = "letter-cell";
        div.textContent = letter;
        div.style.left = `${col * CARD_WIDTH}vw`;
        div.style.top = `${row * CARD_HEIGHT}vh`;
        div.dataset.row = row;
        div.dataset.col = col;
        div.style.display = "none";
        wordLayer.appendChild(div);
      }
    }
  }
}

// --- Card logic ---
function createCards(deck) {
  gameBoard.innerHTML = '';

  deck.forEach((symbol, index) => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.symbol = symbol;
    card.dataset.index = index;

    const row = Math.floor(index / COLS);
    const col = index % COLS;
    card.style.left = `${col * CARD_WIDTH}vw`;
    card.style.top = `${row * CARD_HEIGHT}vh`;

    card.innerHTML = `
      <div class="card-inner card-back"></div>
      <div class="card-inner card-front">${symbol}</div>
    `;

    card.addEventListener("click", () => {
      if (!isPlayerTurn || !allowFlip || revealActive) return;
      if (card.classList.contains("flipped") || card.classList.contains("removed") || flippedCards.length === 2)
        return;
      socket.emit('flipCard', { roomId, cardIndex: index });
    });

    gameBoard.appendChild(card);
  });
}

// --- Reveal logic ---
function flipAllCards(flip = true, hideFront = false) {
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
  if (e.ctrlKey && e.key.toLowerCase() === 'v' && !revealActive) {
    revealActive = true;
    gameBoard.classList.add('hide-background');

    flipAllCards(true);

    setTimeout(() => {
      flipAllCards(false);

      setTimeout(() => {
        gameBoard.classList.remove('hide-background');
        if (revealOverlay) revealOverlay.style.display = 'none';
        revealActive = false;
        socket.emit('revealEnded', { roomId });
      }, 1000);
    }, 10000);
  }
});

// --- Popup logic ---
function showTurnPopup(message = "Your turn is over. Choose an action:") {
  document.getElementById("popup-message").textContent = message;
  document.getElementById("turn-popup").style.display = "flex";
  document.getElementById("popup-input").style.display = "none";
  document.getElementById("submit-guess-btn").style.display = "none";
}

function closePopup() {
  document.getElementById("turn-popup").style.display = "none";
  document.getElementById("popup-input").value = "";
}

// --- Buttons ---
document.getElementById("pass-btn").onclick = () => {
  if (!isPlayerTurn) return;
  isPlayerTurn = false;
  allowFlip = false;
  closePopup();
  socket.emit('passTurn', { roomId });
};

document.getElementById("guess-word-btn").onclick = () => {
  if (!isPlayerTurn) return;
  document.getElementById("popup-input").style.display = "inline-block";
  document.getElementById("submit-guess-btn").style.display = "inline-block";
  document.getElementById("submit-guess-btn").onclick = () => {
    const guess = document.getElementById("popup-input").value.toUpperCase();
    let found = false;
    for (const row of hiddenLetters) {
      if (row.join('').includes(guess)) {
        found = true;
        break;
      }
    }
    if (found) {
      currentScore += 10;
      showTurnPopup(`✅ Correct! +10 points. Score: ${currentScore}`);
      socket.emit('correctWordGuess', { roomId, guess, score: currentScore });
    } else {
      currentScore -= 5;
      isPlayerTurn = false;
      allowFlip = false;
      closePopup();
      alert("❌ Incorrect! -5 points. Turn over.");
      socket.emit('wrongWordGuess', { roomId, guess, score: currentScore });
    }
  };
};

document.getElementById("guess-image-btn").onclick = () => {
  if (!isPlayerTurn) return;
  document.getElementById("popup-input").style.display = "inline-block";
  document.getElementById("submit-guess-btn").style.display = "inline-block";
  document.getElementById("submit-guess-btn").onclick = () => {
    const guess = document.getElementById("popup-input").value.trim().toUpperCase();
    if (guess === pictureAnswer) {
      alert("🎉 You named the picture! Game Over!");
      socket.emit('gameOver', { roomId, winnerId: socket.id });
      location.reload();
    } else {
      currentScore -= 5;
      isPlayerTurn = false;
      allowFlip = false;
      closePopup();
      alert("❌ Wrong! -5 points. Turn over.");
      socket.emit('wrongImageGuess', { roomId, guess, score: currentScore });
    }
  };
};

// --- Socket Events ---
socket.on('updatePlayers', players => {
  console.log('Players in room:', players);
});

socket.on('turnChanged', playerId => {
  isPlayerTurn = (playerId === socket.id);
  allowFlip = isPlayerTurn;
  flippedCards = [];
  closePopup();
  if (isPlayerTurn) {
    console.log("It's your turn! Flip cards.");
  }
});

socket.on('gameDeck', (deck) => {
  console.log('Received deck from server:', deck.length);
  createCards(deck);
});

socket.on('cardFlipped', ({ cardIndex }) => {
  const card = document.querySelector(`.card[data-index="${cardIndex}"]`);
  if (card && !card.classList.contains("flipped")) {
    card.classList.add("flipped");
    flippedCards.push(card);

    if (flippedCards.length === 2) {
      const [card1, card2] = flippedCards;
      if (card1.dataset.symbol === card2.dataset.symbol) {
        socket.emit('matchFound', { roomId, cards: [card1.dataset.index, card2.dataset.index] });
        flippedCards = [];
        allowFlip = true;
      } else {
        allowFlip = false;
        setTimeout(() => {
          card1.classList.remove("flipped");
          card2.classList.remove("flipped");
          flippedCards = [];
          showTurnPopup("No match. Your turn is over. Choose an action.");
        }, 1000);
      }
    }
  }
});

// Handle matched cards from server
socket.on('cardsMatched', (cards) => {
  cards.forEach(cardIndex => {
    const card = document.querySelector(`.card[data-index="${cardIndex}"]`);
    if (card) {
      card.classList.add("removed");
      const left = parseFloat(card.style.left);
      const top = parseFloat(card.style.top);
      const col = Math.round(left / CARD_WIDTH);
      const row = Math.round(top / CARD_HEIGHT);
      const letterDiv = document.querySelector(`.letter-cell[data-row="${row}"][data-col="${col}"]`);
      if (letterDiv) letterDiv.style.display = "flex";
    }
  });
  flippedCards = [];
  allowFlip = true;
});

// Handle cards to flip back on no match
socket.on('flipBackCards', ({ cards }) => {
  cards.forEach(cardIndex => {
    const card = document.querySelector(`.card[data-index="${cardIndex}"]`);
    if (card) card.classList.remove("flipped");
  });
  flippedCards = [];
  allowFlip = true;
  showTurnPopup("No match. Your turn is over. Choose an action.");
});


socket.on('cardsUnmatched', (cards) => {
  cards.forEach(cardIndex => {
    const card = document.querySelector(`.card[data-index="${cardIndex}"]`);
    if (card) card.classList.remove("flipped");
  });
  flippedCards = [];
  allowFlip = true;
  showTurnPopup("No match. Your turn is over. Choose an action.");
});

socket.on('revealStarted', () => {
  revealActive = true;
  if (revealOverlay) revealOverlay.style.display = 'block';
  flipAllCards(true);
});

socket.on('revealEnded', () => {
  revealActive = false;
  if (revealOverlay) revealOverlay.style.display = 'none';
  flipAllCards(false);
});

socket.on('gameOver', (data) => {
  alert(`Game over! Winner: ${data.winnerId}`);
  location.reload();
});

// --- Screen Name Setup ---
startBtn.onclick = () => {
  if (!nameInput.value.trim()) {
    alert("Please enter a screen name.");
    return;
  }
  screenName = nameInput.value.trim();
  startScreen.style.display = 'none';
  gameBoard.style.display = 'block';

  socket.emit('joinRoom', { roomId, playerName: screenName });

  initGame();
};

async function initGame() {
  await placeWords();
  createLetterCells();
  // Cards created when server sends 'deckLayout'
}
