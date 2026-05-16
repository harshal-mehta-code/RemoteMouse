let socket = null;
const touchpad = document.getElementById('touchpad');
const status = document.getElementById('status');
const sensitivitySlider = document.getElementById('sensitivity');
const sessionToggle = document.getElementById('session-toggle');
const keyboardToggle = document.getElementById('keyboard-toggle');
const keyboardContainer = document.getElementById('keyboard-container');
const keyboardInput = document.getElementById('keyboard-input');

let lastX = 0;
let lastY = 0;
let isTouching = false;
let startTouchTime = 0;
let moveCount = 0;
let fingerCount = 0;

// Advanced state
let lastTapTime = 0;
let isDragging = false;
let dragTimeout = null;

// Movement buffer for animation frame
let pendingDx = 0;
let pendingDy = 0;
let pendingScrollY = 0;

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Smart detection: if we are on port 3005, it's Tauri, otherwise use the current host (Electron)
    const wsUrl = window.location.port === '3005' 
        ? `${protocol}//${window.location.hostname}:3005/ws`
        : `${protocol}//${window.location.host}`;
    
    console.log("Connecting to:", wsUrl);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        status.innerText = 'Connected';
        status.style.color = '#4caf50';
        sessionToggle.innerText = 'Disconnect';
        sessionToggle.classList.remove('disconnected');
    };

    socket.onclose = () => {
        status.innerText = 'Disconnected';
        status.style.color = '#f44336';
        sessionToggle.innerText = 'Connect';
        sessionToggle.classList.add('disconnected');
        // Auto-reconnect
        setTimeout(connect, 2000);
    };

    socket.onerror = (error) => {
        console.error('WebSocket Error:', error);
    };
}

function emit(event, data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ event, data }));
    }
}

connect();

sessionToggle.addEventListener('click', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
    } else {
        connect();
    }
});

keyboardToggle.addEventListener('click', () => {
    const isHidden = keyboardContainer.classList.toggle('hidden');
    if (!isHidden) {
        keyboardInput.focus();
    }
});

keyboardInput.addEventListener('input', (e) => {
    const text = e.target.value;
    if (text.length > 0) {
        emit('keyboardType', { text: text });
<<<<<<< HEAD
        e.target.value = ''; 
=======
        e.target.value = ''; // Clear for next character/string
>>>>>>> origin/master
    }
});

keyboardInput.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') {
        emit('keyboardTap', { key: 'backspace' });
    } else if (e.key === 'Enter') {
        emit('keyboardTap', { key: 'enter' });
        e.target.value = '';
    }
});

// High-frequency update loop
function update() {
    const sensitivity = parseFloat(sensitivitySlider.value);
    
    if (pendingDx !== 0 || pendingDy !== 0) {
        const eventName = isDragging ? 'mouseDrag' : 'mouseMove';
        emit(eventName, { dx: pendingDx * sensitivity, dy: pendingDy * sensitivity });
        pendingDx = 0;
        pendingDy = 0;
    }
    
    if (pendingScrollY !== 0) {
        emit('mouseScroll', { deltaY: pendingScrollY * sensitivity });
        pendingScrollY = 0;
    }
    
    requestAnimationFrame(update);
}
requestAnimationFrame(update);

touchpad.addEventListener('touchstart', (e) => {
    e.preventDefault();
<<<<<<< HEAD
=======
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

>>>>>>> origin/master
    isTouching = true;
    touchpad.style.backgroundColor = '#3c3c3c'; 
    fingerCount = e.touches.length;
    
    const touch = e.touches[0];
    lastX = touch.clientX;
    lastY = touch.clientY;
    
    startTouchTime = Date.now();
    moveCount = 0;

    // Handle Long Press for Dragging
    if (fingerCount === 1) {
        dragTimeout = setTimeout(() => {
            if (moveCount < 5 && isTouching) {
                isDragging = true;
                emit('mouseDown', { button: 'left' });
<<<<<<< HEAD
                touchpad.style.backgroundColor = '#007aff'; 
=======
                touchpad.style.backgroundColor = '#007aff'; // Blue feedback for dragging
>>>>>>> origin/master
                if (navigator.vibrate) navigator.vibrate(50);
            }
        }, 500);
    }
});

touchpad.addEventListener('touchmove', (e) => {
<<<<<<< HEAD
    if (!isTouching) return;
=======
    if (!isTouching || !socket || socket.readyState !== WebSocket.OPEN) return;
>>>>>>> origin/master
    e.preventDefault();
    
    const touch = e.touches[0];
    const dx = touch.clientX - lastX;
    const dy = touch.clientY - lastY;
    
    lastX = touch.clientX;
    lastY = touch.clientY;
    
    moveCount++;
    
    if (moveCount > 5 && dragTimeout) {
        clearTimeout(dragTimeout);
        dragTimeout = null;
    }

    if (e.touches.length === 1) {
        pendingDx += dx;
        pendingDy += dy;
    } else if (e.touches.length === 2) {
        pendingScrollY += dy;
    }
});

touchpad.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (!isTouching) return;
    
    if (dragTimeout) {
        clearTimeout(dragTimeout);
        dragTimeout = null;
    }

    const duration = Date.now() - startTouchTime;
    const now = Date.now();
    
    if (isDragging) {
        emit('mouseUp', { button: 'left' });
        isDragging = false;
<<<<<<< HEAD
    } else if (duration < 300 && moveCount < 10) {
=======
    } else if (socket && socket.readyState === WebSocket.OPEN && duration < 300 && moveCount < 10) {
>>>>>>> origin/master
        if (fingerCount === 1) {
            if (now - lastTapTime < 300) {
                emit('mouseClick', { button: 'left', double: true });
<<<<<<< HEAD
                lastTapTime = 0; 
=======
                lastTapTime = 0; // Reset
>>>>>>> origin/master
            } else {
                emit('mouseClick', { button: 'left' });
                lastTapTime = now;
            }
        } else if (fingerCount === 2) {
            emit('mouseClick', { button: 'right' });
        }
    }
    
    if (e.touches.length === 0) {
        isTouching = false;
        touchpad.style.backgroundColor = '#2c2c2c'; 
        fingerCount = 0;
        pendingDx = 0;
        pendingDy = 0;
        pendingScrollY = 0;
    } else {
        fingerCount = e.touches.length;
    }
});

// Start connection
connect();
